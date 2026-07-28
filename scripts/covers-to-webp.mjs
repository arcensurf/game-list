/**
 * One-time backfill: re-encode existing covers to WebP.
 *
 * fetch-covers.mjs converts on the way in, so anything fetched from here on
 * is already WebP. This handles the covers that predate that change — they
 * came down from SteamGridDB as PNG/JPG, which is the wrong format for cover
 * art (a 600x900 grid runs ~700KB as PNG against ~85KB as WebP). Since a
 * page view asks for every cover at once, that difference is what pushes the
 * batch past what the host will serve without throttling.
 *
 * Originals are MOVED to a backup directory rather than deleted, and it sits
 * outside public/ so the dev server doesn't start serving two copies. Delete
 * it once the converted covers look right.
 *
 * Safe to re-run: covers already in WebP are skipped.
 *
 * Usage:
 *   node scripts/covers-to-webp.mjs --dry-run   # report, change nothing
 *   node scripts/covers-to-webp.mjs             # convert
 */

import { loadSharp } from './lib/load-sharp.mjs';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, renameSync } from 'fs';
import { resolve, dirname, extname, basename } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const coversDir = resolve(root, 'public', 'covers');
const coversPath = resolve(root, 'public', 'data', 'covers.json');
const backupDir = resolve(root, '.covers-original');

// Kept in step with fetch-covers.mjs so a backfilled cover and a freshly
// fetched one are encoded identically.
const COVER_WIDTH = 600;
const COVER_HEIGHT = 900;
const WEBP_QUALITY = 82;

const dryRun = process.argv.includes('--dry-run');
const sharp = await loadSharp();

const covers = JSON.parse(readFileSync(coversPath, 'utf-8'));

// The manifest is keyed by game title, but the files on disk only know their
// own names — so invert it once to look up "which titles reference this file"
// while walking the directory.
//
// Deliberately file -> title[] and not file -> title. Renamed games can leave
// two keys pointing at one file ("Persona 4 Arena" and "Persona 4 Arena
// (Story Mode)" both claim persona-4-arena-story-mode), and a plain Map would
// keep only whichever was seen last, leaving the other stranded on a filename
// that no longer exists.
const titlesByFile = new Map();
for (const [title, entry] of Object.entries(covers)) {
  if (!entry?.file) continue;
  if (!titlesByFile.has(entry.file)) titlesByFile.set(entry.file, []);
  titlesByFile.get(entry.file).push(title);
}

const files = readdirSync(coversDir).filter((f) => !f.startsWith('.'));
const pending = files.filter((f) => extname(f).toLowerCase() !== '.webp');

// Deliberately NOT an early exit when there's nothing to convert. The
// manifest can still be pointing at pre-conversion filenames even when every
// file on disk is already WebP, so the reconcile pass at the bottom has to
// get a chance to run and repair those.
if (pending.length === 0) {
  console.log('No files to convert — checking the manifest for stale entries.');
}

// A slug can have both a .jpg and a .png on disk — a cover re-fetched after
// SteamGridDB switched formats writes the new file without removing the old
// one. Both want the same .webp name, so pick per slug by what the manifest
// actually points at; the loser is dead weight and gets retired unconverted.
const bySlug = new Map();
for (const f of pending) {
  const slug = basename(f, extname(f));
  if (!bySlug.has(slug)) bySlug.set(slug, []);
  bySlug.get(slug).push(f);
}

const toConvert = [];
const toRetire = [];

for (const [slug, candidates] of bySlug) {
  if (candidates.length === 1) {
    toConvert.push(candidates[0]);
    continue;
  }

  const referenced = candidates.filter((f) => titlesByFile.has(f));

  if (referenced.length === 1) {
    toConvert.push(referenced[0]);
    toRetire.push(...candidates.filter((f) => f !== referenced[0]));
  } else if (referenced.length === 0) {
    // Nothing in the manifest points at any of them — the game was renamed
    // or removed. Retire the whole set rather than guess which to keep.
    toRetire.push(...candidates);
    console.log(`  [DEAD]   ${slug} — no manifest entry for any of: ${candidates.join(', ')}`);
  } else {
    console.error(`Refusing to run — ${slug} has multiple manifest entries: ${referenced.join(', ')}`);
    process.exit(1);
  }
}

if (!dryRun && !existsSync(backupDir)) {
  mkdirSync(backupDir, { recursive: true });
}

let converted = 0;
let orphans = 0;
let failed = 0;
let retired = 0;
let bytesFrom = 0;
let bytesTo = 0;

for (const file of toRetire) {
  if (!dryRun) renameSync(resolve(coversDir, file), resolve(backupDir, file));
  retired++;
}

for (const file of toConvert) {
  const sourcePath = resolve(coversDir, file);
  const target = `${basename(file, extname(file))}.webp`;
  const targetPath = resolve(coversDir, target);
  const titles = titlesByFile.get(file) ?? [];

  try {
    const source = readFileSync(sourcePath);
    const webp = await sharp(source)
      .resize(COVER_WIDTH, COVER_HEIGHT, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();

    bytesFrom += source.length;
    bytesTo += webp.length;

    if (!dryRun) {
      writeFileSync(targetPath, webp);
      // Move rather than unlink — 14 of these covers exist nowhere but this
      // directory (never committed to the data branch), so an unlink would
      // be unrecoverable.
      renameSync(sourcePath, resolve(backupDir, file));
      for (const title of titles) covers[title].file = target;
    }

    converted++;
    // A file no manifest entry points at still gets converted — harmless,
    // but flag it, since it means either a stale leftover or a manifest that
    // has drifted from the directory.
    if (titles.length === 0) {
      orphans++;
      console.log(`  [ORPHAN] ${file} -> ${target} (no manifest entry)`);
    }
  } catch (err) {
    failed++;
    console.warn(`  [FAIL] ${file} - ${err.message}`);
  }
}

// Reconcile pass: catch any manifest entry still naming a file that isn't on
// disk when its .webp sibling is. The conversion loop above handles the
// common case, but this covers entries it couldn't reach — and makes a re-run
// self-healing rather than dependent on there being files left to convert.
let repaired = 0;
const onDisk = new Set(readdirSync(coversDir));
for (const [title, entry] of Object.entries(covers)) {
  if (!entry?.file || onDisk.has(entry.file)) continue;
  // Captured before the write below — `entry` aliases covers[title], so
  // reading entry.file afterwards would report the new name as the old one.
  const stale = entry.file;
  const sibling = `${basename(stale, extname(stale))}.webp`;
  if (onDisk.has(sibling)) {
    if (!dryRun) covers[title].file = sibling;
    repaired++;
    console.log(`  [REPAIR] ${JSON.stringify(title)}: ${stale} -> ${sibling}`);
  } else {
    console.warn(`  [DANGLING] ${JSON.stringify(title)} -> ${entry.file} (no file, no .webp)`);
  }
}

if (!dryRun) {
  writeFileSync(coversPath, JSON.stringify(covers, null, 2) + '\n');
}

const pct = bytesFrom > 0 ? Math.round((1 - bytesTo / bytesFrom) * 100) : 0;
console.log(
  `\n${dryRun ? '[dry run] ' : ''}Converted ${converted}, retired ${retired},` +
    ` failed ${failed}, orphans ${orphans}`,
);
console.log(`Size: ${(bytesFrom / 1048576).toFixed(1)} MB -> ${(bytesTo / 1048576).toFixed(1)} MB (-${pct}%)`);
if (!dryRun) {
  console.log(`Manifest: ${coversPath}`);
  console.log(`Originals moved to: ${backupDir}`);
}
