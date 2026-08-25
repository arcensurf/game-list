/**
 * Sweep the bucket for covers that aren't WebP and convert them in place.
 *
 * This is the backstop for the dev cover picker. `encodeCover` in
 * dev-api-plugin.ts degrades rather than failing when sharp is missing,
 * so a cover picked on a checkout without it lands as PNG/JPG — a
 * 600x900 grid runs ~700KB as PNG against ~85KB as WebP, and a page view
 * asks for every cover at once. The postinstall hook makes that rare
 * locally, but rare isn't never, and nothing local is guaranteed to run.
 * CI is: this runs where sharp is installed as a build step, so the
 * degraded case self-heals within a day instead of waiting to be noticed.
 *
 *   node scripts/convert-covers-r2.mjs             # convert
 *   node scripts/convert-covers-r2.mjs --dry-run   # report only
 *
 * Normally a no-op: one listing call, nothing to do, done.
 */
import { loadSharp } from './lib/load-sharp.mjs';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { config } from 'dotenv';
import {
  listObjects,
  getObject,
  getObjectWithEtag,
  putObject,
  deleteObject,
  PreconditionFailed,
  BUCKET,
} from './lib/r2.mjs';

config({ path: '.env.local', quiet: true });

// Kept in step with fetch-covers.mjs and dev-api-plugin.ts's encodeCover,
// so a swept cover is byte-comparable to a freshly picked one.
const COVER_WIDTH = 600;
const COVER_HEIGHT = 900;
const WEBP_QUALITY = 82;

const COVERS_KEY = 'data/covers.json';
const dryRun = process.argv.includes('--dry-run');

// Where the workflow looks to decide whether to raise an issue. Created
// here rather than assumed: unlike the fetch workflow, this job has no
// token-cache step to make the directory first.
const tokenDir = process.env.TOKEN_DIR || resolve(process.env.HOME || '.', '.game-list');
mkdirSync(tokenDir, { recursive: true });
const FAILURE_FILE = resolve(tokenDir, 'cover-convert-failed');

const remote = await listObjects('covers/');
const stale = [...remote.keys()].filter((k) => !/\.webp$/i.test(k));

console.log(`Bucket: ${BUCKET}${dryRun ? '  (dry run)' : ''}`);
console.log(`covers: ${remote.size} total, ${stale.length} not WebP`);

if (stale.length === 0) {
  if (!dryRun) writeFileSync(FAILURE_FILE, '');
  console.log('Nothing to convert.');
  process.exit(0);
}

for (const k of stale) console.log(`  ${k}`);
if (dryRun) process.exit(0);

const sharp = await loadSharp();

// Convert and upload first, leaving the originals in place. Order matters:
// covers.json must never name a file that isn't there, so the new object
// exists before the manifest points at it, and the old one is only removed
// after. A crash in between leaves an unused object, which the next run
// tidies — the reverse order would leave a broken cover on the live site.
const converted = [];
const failures = [];

for (const key of stale) {
  const base = key.replace(/^covers\//, '');
  const outBase = base.replace(/\.[^.]+$/, '.webp');
  const outKey = `covers/${outBase}`;
  try {
    const body = await getObject(key);
    if (body === null) throw new Error('listed but missing');
    const webp = await sharp(body)
      .resize(COVER_WIDTH, COVER_HEIGHT, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
    await putObject(outKey, webp, 'image/webp');
    converted.push({ key, outKey, from: base, to: outBase, before: body.length, after: webp.length });
    const pct = Math.round((1 - webp.length / body.length) * 100);
    console.log(`  converted ${base} -> ${outBase}  (${(body.length / 1024).toFixed(0)}KB -> ${(webp.length / 1024).toFixed(0)}KB, -${pct}%)`);
  } catch (err) {
    failures.push(`${base}: ${err.message}`);
    console.error(`  ✗ ${base}: ${err.message}`);
  }
}

/**
 * Point covers.json at the converted files.
 *
 * covers.json belongs to the app's Publish button, not to this job, so it
 * cannot be written from a copy read at the start of the run — a publish
 * landing in between would be silently reverted. Instead: re-read it here,
 * change only the entries this run converted, and write conditionally on
 * the ETag. If a publish lands inside that window the PUT is refused
 * rather than applied, and the retry re-reads and reapplies on top.
 */
async function updateManifest() {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const current = await getObjectWithEtag(COVERS_KEY);
    if (!current) throw new Error(`${COVERS_KEY} is missing from the bucket`);
    const covers = JSON.parse(current.body.toString('utf-8'));

    // file -> titles, not file -> title: a renamed game can leave two keys
    // pointing at the same file, and keeping only the last seen would strand
    // the other on a filename that no longer exists.
    const titlesByFile = new Map();
    for (const [title, entry] of Object.entries(covers)) {
      if (!entry?.file) continue;
      if (!titlesByFile.has(entry.file)) titlesByFile.set(entry.file, []);
      titlesByFile.get(entry.file).push(title);
    }

    let touched = 0;
    for (const { from, to } of converted) {
      for (const title of titlesByFile.get(from) ?? []) {
        covers[title].file = to;
        touched++;
      }
    }

    if (touched === 0) {
      console.log('covers.json: no entries referenced the converted files — leaving it alone');
      return;
    }

    const body = Buffer.from(JSON.stringify(covers, null, 2) + '\n');
    try {
      await putObject(COVERS_KEY, body, 'application/json', { ifMatch: current.etag });
      console.log(`covers.json: ${touched} entr${touched === 1 ? 'y' : 'ies'} repointed`);
      return;
    } catch (err) {
      if (!(err instanceof PreconditionFailed)) throw err;
      console.warn(`covers.json changed underneath us — retrying (attempt ${attempt}/5)`);
    }
  }
  throw new Error('covers.json kept changing under us — giving up rather than clobbering a publish');
}

if (converted.length > 0) {
  await updateManifest();
  // Only now that nothing references them.
  for (const { key } of converted) {
    await deleteObject(key);
    console.log(`  removed ${key}`);
  }
}

writeFileSync(FAILURE_FILE, failures.join('\n'));

console.log(`\n${converted.length} converted, ${failures.length} failed`);
if (failures.length > 0) process.exitCode = 1;
