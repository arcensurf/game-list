/**
 * Syncs local data files up to the R2 bucket the site reads from.
 *
 *   node scripts/r2-sync.mjs covers        # public/covers  -> covers/
 *   node scripts/r2-sync.mjs data          # public/data    -> data/
 *   node scripts/r2-sync.mjs               # both
 *
 *   --dry-run       report what would change, upload nothing
 *   --prune         delete remote objects with no local counterpart
 *   --force-prune   allow a prune past the safety limit
 *   --only=a,b/c    restrict to these paths inside the target (prune too)
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
const forcePrune = args.includes('--force-prune');
const targets = args.filter((a) => !a.startsWith('--'));

// --only narrows a target to named files and directories inside it, and
// narrows the prune to match. The nightly needs this: it rewrites the
// derived files but only *reads* games.json, covers.json and overrides/,
// which the app's publish path writes directly. Without a scope, a
// publish landing mid-run would be overwritten by the copy the nightly
// pulled before it — the race the old data-branch commit step handled
// with pull --rebase. Not syncing what it didn't produce removes the
// race outright rather than retrying through it.
const onlyArg = args.find((a) => a.startsWith('--only='));
const only = onlyArg
  ? onlyArg.slice('--only='.length).split(',').map((p) => p.trim()).filter(Boolean)
  : null;

// A prune deletes every remote object with no local counterpart, which
// is only the right call when the local tree is known-complete. The
// nightly's local tree comes from r2-pull.mjs, so a pull that silently
// came up short would present as a large, entirely legitimate-looking
// set of deletions. Nothing downstream can tell those apart, so cap it:
// pruning a small tail is routine (a delisted game's shard), pruning a
// third of the bucket is a bug somewhere upstream. --force-prune is the
// deliberate override for the rare real mass deletion.
const PRUNE_LIMIT_FRACTION = 0.2;
const PRUNE_LIMIT_FLOOR = 25;

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

  // A scoped key is either the named file itself or anything beneath it
  // as a directory — `achievements` must not also match `achievements.json`.
  const inScope = (key) => {
    if (!only) return true;
    const rel = key.slice(prefix.length);
    return only.some((p) => rel === p || rel.startsWith(`${p}/`));
  };

  const local = new Map();
  for (const file of walk(dir)) {
    // Forward slashes: this is an object key, not a filesystem path.
    const key = prefix + relative(dir, file).split(/[\\/]/).join('/');
    if (!inScope(key)) continue;
    local.set(key, file);
  }

  const remote = new Map(
    [...(await listObjects(prefix))].filter(([key]) => inScope(key)),
  );

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
    `${name}${only ? ` [${only.join(', ')}]` : ''}: ${local.size} local, ${remote.size} remote — ` +
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
    // Floor as well as fraction, so a small prefix isn't held to a
    // threshold of two objects.
    const limit = Math.max(PRUNE_LIMIT_FLOOR, Math.floor(remote.size * PRUNE_LIMIT_FRACTION));
    if (stale.length > limit && !forcePrune) {
      console.error(
        `${name}: refusing to prune ${stale.length} of ${remote.size} remote objects ` +
          `(limit ${limit}). This usually means the local tree is incomplete, not that ` +
          `the files were really deleted. Re-run the pull, or pass --force-prune if the ` +
          `deletion is genuine.`,
      );
      for (const k of stale.slice(0, 10)) console.error(`   would have deleted ${k}`);
      process.exitCode = 1;
      return;
    }
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
