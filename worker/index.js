/**
 * Serves the game-list data bucket to browsers.
 *
 * R2's S3 endpoint needs signed requests, so a browser can't read the
 * bucket directly. The alternative to this Worker is connecting a custom
 * domain to the bucket — which is simpler, but needs a domain on
 * Cloudflare DNS. This is the no-domain path: workers.dev is supported
 * for production use (unlike the r2.dev bucket URL, which is explicitly
 * development-only and rate limited).
 *
 * Runs on the Workers free plan, which caps at 100k requests/day and
 * then fails closed with error 1027 rather than billing. That cap is
 * also what bounds R2 spend: at most one Class B read per request,
 * ~3.1M/month against a 10M free allowance. Egress on R2 is always free.
 */

// Only these prefixes are served. A scanner probing for /.env or
// /wp-login gets a flat 404 without touching R2 — it still costs a Worker
// invocation (nothing avoids that), but it costs no storage operation and
// keeps the surface to exactly what the app asks for.
const ALLOWED_PREFIXES = ['covers/', 'data/'];

// Covers and shards are content-addressed in practice: a cover's filename
// changes when its art does, and a shard is rewritten only when its
// counts move. So they can be cached hard. The small top-level JSON files
// are rewritten nightly in place under stable names, so they get a short
// TTL and revalidate instead.
const IMMUTABLE = 'public, max-age=31536000, immutable';
const REVALIDATE = 'public, max-age=300, stale-while-revalidate=86400';

const NIGHTLY_FILES = new Set([
  'data/games.json',
  'data/covers.json',
  'data/achievements.json',
  'data/leaderboard.json',
  'data/timeline.json',
  'data/cover-tints.json',
  'data/platform-libraries.json',
]);

function cachePolicy(key) {
  return NIGHTLY_FILES.has(key) ? REVALIDATE : IMMUTABLE;
}

export default {
  async fetch(request, env, ctx) {
    // Read-only surface. Writes go through the S3 API with credentials,
    // never through here.
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', {
        status: 405,
        headers: { Allow: 'GET, HEAD' },
      });
    }

    const url = new URL(request.url);
    const key = decodeURIComponent(url.pathname.replace(/^\/+/, ''));

    if (!key || !ALLOWED_PREFIXES.some((p) => key.startsWith(p))) {
      return new Response('Not found', { status: 404 });
    }

    // The Cache API is per-data-centre and does not replicate, so this
    // helps a busy edge and does nothing for a cold one. Still worth it:
    // a cache hit skips the R2 read entirely.
    const cache = caches.default;
    const cacheKey = new Request(url.toString(), { method: 'GET' });
    const hit = await cache.match(cacheKey);
    if (hit) {
      // HEAD can be served from a cached GET by dropping the body.
      return request.method === 'HEAD' ? new Response(null, hit) : hit;
    }

    const object = await env.BUCKET.get(key, {
      // Lets R2 answer a conditional request itself — a browser holding a
      // stale copy gets a 304 with no body rather than the whole file.
      onlyIf: request.headers,
      range: request.headers,
    });

    if (object === null) {
      return new Response('Not found', { status: 404 });
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('cache-control', cachePolicy(key));
    // The app is served from a different origin (GitHub Pages), so these
    // need to be readable cross-origin.
    headers.set('access-control-allow-origin', '*');

    // `body` is absent when R2 answered a conditional or an unsatisfiable
    // range — status has to follow, or the client waits for bytes that
    // are never coming.
    if (!('body' in object) || object.body === null) {
      return new Response(null, { status: 304, headers });
    }

    const status = object.range ? 206 : 200;
    const response = new Response(object.body, { status, headers });

    // Only full, successful GETs are worth caching — a 206 would poison
    // the entry for everyone who wants the whole file.
    if (status === 200) {
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
    }

    return request.method === 'HEAD'
      ? new Response(null, { status, headers })
      : response;
  },
};
