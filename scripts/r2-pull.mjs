/**
 * Mirrors the R2 bucket down to the local tree — the read half of
 * r2-sync.mjs, and the nightly's replacement for checking out the data
 * branch.
 *
 *   node scripts/r2-pull.mjs data          # data/    -> public/data
 *   node scripts/r2-pull.mjs covers        # covers/  -> public/covers
 *   node scripts/r2-pull.mjs               # both
 *
 *   --dry-run    report what would change, download nothing
 *
 * Unchanged files are skipped by comparing the local MD5 against the
 * object's ETag, exactly as the sync does in the other direction.
 *
 * This fails hard on the first error rather than pressing on with a
 * partial tree. That matters more here than it would elsewhere: the
 * nightly pulls, rewrites, and then syncs back with --prune, so a
 * half-finished pull would look like "these objects no longer exist
 * locally" and prune would delete them from the bucket. Refusing to
 * produce a partial tree is what makes the round trip safe.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { config } from 'dotenv';
import { getObject, listObjects, etagOf, BUCKET } from './lib/r2.mjs';

config({ path: '.env.local', quiet: true });

const CONCURRENCY = 8;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const targets = args.filter((a) => !a.startsWith('--'));

const root = process.cwd();
const SOURCES = {
  covers: { dir: resolve(root, 'public/covers'), prefix: 'covers/' },
  data: { dir: resolve(root, 'public/data'), prefix: 'data/' },
};

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

async function pullOne(name) {
  const { dir, prefix } = SOURCES[name];
  const remote = await listObjects(prefix);

  const toFetch = [];
  let unchanged = 0;
  for (const [key, meta] of remote) {
    const dest = join(dir, key.slice(prefix.length));
    if (existsSync(dest) && etagOf(readFileSync(dest)) === meta.etag) {
      unchanged++;
      continue;
    }
    toFetch.push({ key, dest });
  }

  console.log(
    `${name}: ${remote.size} remote — ${toFetch.length} to download, ${unchanged} already current`,
  );

  if (dryRun) {
    for (const f of toFetch.slice(0, 10)) console.log(`   would download ${f.key}`);
    if (toFetch.length > 10) console.log(`   ... and ${toFetch.length - 10} more`);
    return;
  }

  let done = 0;
  const errors = [];
  await runPool(toFetch, async ({ key, dest }) => {
    try {
      const body = await getObject(key);
      // A key that listed a moment ago and 404s now means something is
      // writing to the bucket underneath us — not a file to skip.
      if (body === null) throw new Error('listed but missing');
      mkdirSync(dirname(dest), { recursive: true });
      // Temp-and-rename so an interrupted run can never leave a
      // half-written file that the next run's ETag check would happily
      // accept as current.
      const tmp = `${dest}.tmp`;
      writeFileSync(tmp, body);
      renameSync(tmp, dest);
    } catch (err) {
      errors.push(`${key}: ${err.message}`);
      return;
    }
    done++;
    if (done % 100 === 0) console.log(`   ${done}/${toFetch.length}`);
  });

  if (errors.length > 0) {
    console.error(`${name}: ${errors.length} object(s) failed to download`);
    for (const e of errors.slice(0, 10)) console.error(`   ✗ ${e}`);
    throw new Error(
      `${name}: incomplete pull — refusing to continue, because a later ` +
        `sync --prune would read the gaps as deletions`,
    );
  }

  console.log(`${name}: ${done} downloaded, ${unchanged} already current`);
}

const chosen = targets.length > 0 ? targets : Object.keys(SOURCES);
for (const name of chosen) {
  if (!SOURCES[name]) {
    console.error(`Unknown target "${name}" — expected one of: ${Object.keys(SOURCES).join(', ')}`);
    process.exit(1);
  }
}

console.log(`Bucket: ${BUCKET}${dryRun ? '  (dry run)' : ''}\n`);
for (const name of chosen) await pullOne(name);
