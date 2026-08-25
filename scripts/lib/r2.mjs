/**
 * Minimal S3 (SigV4) client for the R2 data bucket.
 *
 * Hand-rolled rather than @aws-sdk/client-s3 on purpose: the nightly
 * workflow runs `npm ci`, so every dependency here is paid on every CI
 * run, and this needs four operations against one bucket. SigV4 is a
 * fixed, well-specified algorithm — the whole surface is below.
 *
 * Credentials come from the environment (R2_ACCESS_KEY_ID /
 * R2_SECRET_ACCESS_KEY) and are never logged.
 */
import { createHash, createHmac } from 'crypto';

const ACCOUNT_ID = '17c6f37a6199478cf45e14fbf30a0e4a';
export const BUCKET = process.env.R2_BUCKET || 'game-list-data';
const HOST = `${ACCOUNT_ID}.r2.cloudflarestorage.com`;
// R2 ignores region but SigV4 requires one in the credential scope, and
// it has to match what the server expects. "auto" is what R2 documents.
const REGION = 'auto';
const SERVICE = 's3';

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();

function credentials() {
  const id = process.env.R2_ACCESS_KEY_ID;
  const secret = process.env.R2_SECRET_ACCESS_KEY;
  if (!id || !secret) {
    throw new Error(
      'R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY not set — add them to .env.local locally, or to the repo secrets in CI',
    );
  }
  return { id, secret };
}

// Each path segment is encoded separately: a literal "/" separates keys
// and must survive, everything else that isn't unreserved gets escaped.
// encodeURIComponent leaves !'()* alone, which S3 wants encoded.
function encodeKey(key) {
  return key
    .split('/')
    .map((seg) =>
      encodeURIComponent(seg).replace(
        /[!'()*]/g,
        (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
      ),
    )
    .join('/');
}

/**
 * Signs one request and returns the headers for it.
 *
 * `query` is the canonical query string (already sorted and encoded) —
 * only list needs it.
 */
function sign({ method, key = '', query = '', body = '', headers = {} }) {
  const { id, secret } = credentials();
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);

  const payloadHash = sha256(body);
  const canonicalUri = '/' + (key ? encodeKey(key) : '');

  const allHeaders = {
    host: HOST,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...headers,
  };
  // Signed headers must be lowercase, sorted, and match what's sent.
  const sortedKeys = Object.keys(allHeaders)
    .map((h) => h.toLowerCase())
    .sort();
  const canonicalHeaders = sortedKeys
    .map((h) => {
      const value = allHeaders[Object.keys(allHeaders).find((k) => k.toLowerCase() === h)];
      return `${h}:${String(value).trim().replace(/\s+/g, ' ')}\n`;
    })
    .join('');
  const signedHeaders = sortedKeys.join(';');

  const canonicalRequest = [
    method,
    canonicalUri,
    query,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256(canonicalRequest),
  ].join('\n');

  let signingKey = hmac(`AWS4${secret}`, dateStamp);
  for (const part of [REGION, SERVICE, 'aws4_request']) signingKey = hmac(signingKey, part);
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  return {
    ...allHeaders,
    Authorization:
      `AWS4-HMAC-SHA256 Credential=${id}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

function url(key = '', query = '') {
  return `https://${HOST}/${key ? encodeKey(key) : ''}${query ? `?${query}` : ''}`;
}

/**
 * Thrown when a conditional write loses the race — the object changed
 * between the read and the write. Distinguishable so a caller can retry
 * the read-modify-write instead of treating it as a hard failure.
 */
export class PreconditionFailed extends Error {
  constructor(key) {
    super(`PUT ${key} failed the If-Match precondition — the object changed underneath us`);
    this.name = 'PreconditionFailed';
  }
}

/**
 * Download one object along with its ETag, for a read-modify-write.
 * Returns { body, etag }, or null when the key is absent — in which case
 * a following putObject should pass `ifNoneMatch: true` to claim it only
 * if it is still absent.
 */
export async function getObjectWithEtag(key) {
  const objectKey = `${BUCKET}/${key}`;
  const headers = sign({ method: 'GET', key: objectKey });
  const res = await fetch(url(objectKey), { headers });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${key} failed: ${res.status} ${await res.text()}`);
  return {
    body: Buffer.from(await res.arrayBuffer()),
    // Quotes are kept — If-Match compares the quoted form literally — but
    // the W/ prefix has to go. R2 answers a GET with a *weak* validator,
    // and If-Match requires a strong one, so passing it back verbatim gets
    // every conditional write rejected with a 412 that looks exactly like
    // a lost race. Same hash underneath; only the marker differs.
    etag: (res.headers.get('etag') || '').replace(/^W\//, ''),
  };
}

/** Upload one object. `body` is a Buffer. */
export async function putObject(key, body, contentType, opts = {}) {
  const objectKey = `${BUCKET}/${key}`;
  // Conditional write. `ifMatch` makes the PUT land only if the object
  // still has that ETag; `ifNoneMatch: true` only if it does not exist.
  // Either way R2 answers 412 rather than overwriting, which is what
  // turns a lost race into a retry instead of silent data loss.
  const conditional = {};
  if (opts.ifMatch) conditional['if-match'] = opts.ifMatch;
  if (opts.ifNoneMatch) conditional['if-none-match'] = '*';
  const headers = sign({
    method: 'PUT',
    key: objectKey,
    body,
    headers: { 'content-type': contentType, ...conditional },
  });
  const res = await fetch(url(objectKey), { method: 'PUT', headers, body });
  if (res.status === 412) throw new PreconditionFailed(key);
  if (!res.ok) {
    throw new Error(`PUT ${key} failed: ${res.status} ${await res.text()}`);
  }
}

/**
 * Download one object. Returns a Buffer, or null when the key is absent.
 */
export async function getObject(key) {
  const objectKey = `${BUCKET}/${key}`;
  const headers = sign({ method: 'GET', key: objectKey });
  const res = await fetch(url(objectKey), { headers });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`GET ${key} failed: ${res.status} ${await res.text()}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/** Delete one object. */
export async function deleteObject(key) {
  const objectKey = `${BUCKET}/${key}`;
  const headers = sign({ method: 'DELETE', key: objectKey });
  const res = await fetch(url(objectKey), { method: 'DELETE', headers });
  // S3 answers 204 on delete, and treats deleting a missing key as fine.
  if (!res.ok && res.status !== 404) {
    throw new Error(`DELETE ${key} failed: ${res.status} ${await res.text()}`);
  }
}

/**
 * List every key under a prefix, following continuation tokens.
 * Returns a Map of key -> { size, etag }.
 */
export async function listObjects(prefix = '') {
  const out = new Map();
  let token = null;
  do {
    // Canonical query: sorted by key, every value encoded.
    const params = [
      ['continuation-token', token],
      ['list-type', '2'],
      ['max-keys', '1000'],
      ['prefix', prefix],
    ]
      .filter(([, v]) => v != null && v !== '')
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');

    const headers = sign({ method: 'GET', key: BUCKET, query: params });
    const res = await fetch(url(BUCKET, params), { headers });
    if (!res.ok) throw new Error(`LIST failed: ${res.status} ${await res.text()}`);
    const xml = await res.text();

    for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const body = m[1];
      const key = body.match(/<Key>([\s\S]*?)<\/Key>/)?.[1];
      if (!key) continue;
      out.set(key, {
        size: Number(body.match(/<Size>(\d+)<\/Size>/)?.[1] ?? 0),
        etag: (body.match(/<ETag>([\s\S]*?)<\/ETag>/)?.[1] ?? '').replace(/^&quot;|&quot;$/g, '').replace(/"/g, ''),
      });
    }

    token = xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)?.[1] ?? null;
    // Only keep paging while the server says the listing was cut short.
    if (!/<IsTruncated>true<\/IsTruncated>/.test(xml)) token = null;
  } while (token);

  return out;
}

/** MD5, which is what S3/R2 puts in the ETag for a single-part upload. */
export function etagOf(buffer) {
  return createHash('md5').update(buffer).digest('hex');
}
