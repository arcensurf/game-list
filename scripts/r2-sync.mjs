/**
 * Syncs local data files up to the R2 bucket the site reads from.
 *
 *   node scripts/r2-sync.mjs covers        # public/covers  -> covers/
 *   node scripts/r2-sync.mjs data          # public/data    -> data/
 *   node scripts/r2-sync.mjs               # both
 *
 *   --dry-run    report what would change, upload nothing
 *   --prune      delete remote objects with no local counterpart
 *
 * Unchanged files are skipped by comparing the local MD5 against the
 * object's ETag, which R2 sets to the MD5 for single-part uploads. That
 * makes a re-run nearly free: only what actually changed is sent.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { resolve, join, extname, relative } from 'path';
import { config } from 'dotenv';
import { putObject, listObjects, deleteObject, etagOf, BUCKET } from './lib/r2.mjs';

config({ path: '.env.local', quiet: true });

const CONTENT_TYPES = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.txt': 'text/plain',
};

// How many uploads are in flight at once. R2 is comfortable well past
// this; the cap is about not opening 250 sockets from a laptop.
const CONCURRENCY = 8;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const prune = args.includes('--prune');
const targets = args.filter((a) => !a.startsWith('--'));

const root = process.cwd();
const SOURCES = {
  covers: { dir: resolve(root, 'public/covers'), prefix: 'covers/' },
  data: { dir: resolve(root, 'public/data'), prefix: 'data/' },
};

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    // .DS_Store and friends have no business in a public bucket.
    if (entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

async function runPool(items, worker) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index]);
    }
  });
  await Promise.all(runners);
}

async function syncOne(name) {
  const { dir, prefix } = SOURCES[name];
  if (!existsSync(dir)) {
    console.log(`${name}: ${dir} does not exist — skipping`);
    return;
  }

  const local = new Map();
  for (const file of walk(dir)) {
    // Forward slashes: this is an object key, not a filesystem path.
    local.set(prefix + relative(dir, file).split(/[\\/]/).join('/'), file);
  }

  const remote = await listObjects(prefix);

  const toUpload = [];
  let unchanged = 0;
  for (const [key, file] of local) {
    const body = readFileSync(file);
    if (remote.get(key)?.etag === etagOf(body)) {
      unchanged++;
      continue;
    }
    toUpload.push({ key, file, body });
  }

  const stale = [...remote.keys()].filter((k) => !local.has(k));

  const bytes = toUpload.reduce((sum, u) => sum + u.body.length, 0);
  console.log(
    `${name}: ${local.size} local, ${remote.size} remote — ` +
      `${toUpload.length} to upload (${(bytes / 1048576).toFixed(2)} MB), ` +
      `${unchanged} unchanged, ${stale.length} stale`,
  );

  if (dryRun) {
    for (const u of toUpload.slice(0, 10)) console.log(`   would upload ${u.key}`);
    if (toUpload.length > 10) console.log(`   ... and ${toUpload.length - 10} more`);
    for (const k of stale.slice(0, 10)) console.log(`   would ${prune ? 'DELETE' : 'leave'} ${k}`);
    return;
  }

  let done = 0;
  let failed = 0;
  await runPool(toUpload, async ({ key, file, body }) => {
    const type = CONTENT_TYPES[extname(file).toLowerCase()] || 'application/octet-stream';
    try {
      await putObject(key, body, type);
    } catch (err) {
      // One bad object shouldn't abandon the rest — report and continue,
      // then fail the run at the end so CI notices.
      failed++;
      console.error(`   ✗ ${key}: ${err.message}`);
      return;
    }
    done++;
    if (done % 50 === 0) console.log(`   ${done}/${toUpload.length}`);
  });

  if (prune && stale.length > 0) {
    for (const key of stale) {
      await deleteObject(key);
      console.log(`   deleted ${key}`);
    }
  }

  console.log(`${name}: ${done} uploaded, ${failed} failed${prune ? `, ${stale.length} pruned` : ''}`);
  if (failed > 0) process.exitCode = 1;
}

const chosen = targets.length > 0 ? targets : Object.keys(SOURCES);
for (const name of chosen) {
  if (!SOURCES[name]) {
    console.error(`Unknown target "${name}" — expected one of: ${Object.keys(SOURCES).join(', ')}`);
    process.exit(1);
  }
}

console.log(`Bucket: ${BUCKET}${dryRun ? '  (dry run)' : ''}\n`);
for (const name of chosen) await syncOne(name);
