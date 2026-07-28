/**
 * Fetch cover images from SteamGridDB and save them locally.
 *
 * Reads public/data/games.json, checks public/data/covers.json for existing
 * entries, and downloads missing covers to public/covers/.
 *
 * SteamGridDB serves mostly PNG, which is the wrong format for cover art —
 * a 600x900 grid lands around 700KB as PNG versus ~80KB as WebP. Since a
 * page view requests every cover at once, that difference is the difference
 * between covers loading and covers getting throttled. So whatever format
 * SGDB hands us gets re-encoded to WebP here, on the way in; the manifest
 * only ever records the .webp filename.
 *
 * Usage:
 *   npm run fetch-covers              # fetch all missing covers
 *   npm run fetch-covers -- --force   # re-fetch all covers
 *
 * Requires SGDB_API_KEY in .env.local
 */

import dotenv from 'dotenv';
import SGDB from 'steamgriddb';
import sharp from 'sharp';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '..', '.env.local') });
const gamesPath = resolve(__dirname, '..', 'public', 'data', 'games.json');
const coversPath = resolve(__dirname, '..', 'public', 'data', 'covers.json');
const coversDir = resolve(__dirname, '..', 'public', 'covers');

// Matches SGDB's preferred grid size. Cards render far smaller, but the
// extra pixels cost little at WebP sizes and cover retina. The cap only
// bites on the fallback path below, where an unfiltered grid query can
// return something much larger.
const COVER_WIDTH = 600;
const COVER_HEIGHT = 900;
const WEBP_QUALITY = 82;

const apiKey = process.env.SGDB_API_KEY;
if (!apiKey || apiKey === 'your_api_key_here') {
  console.error('Set SGDB_API_KEY in .env.local');
  console.error('Get a free key at https://www.steamgriddb.com/profile/preferences');
  process.exit(1);
}

const force = process.argv.includes('--force');
const client = new SGDB(apiKey);

// Ensure output directory exists
if (!existsSync(coversDir)) {
  mkdirSync(coversDir, { recursive: true });
}

// Load data
const games = JSON.parse(readFileSync(gamesPath, 'utf-8'));
let covers = {};
if (existsSync(coversPath)) {
  covers = JSON.parse(readFileSync(coversPath, 'utf-8'));
}

function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Download and re-encode in one step — the source bytes never hit disk, so
// there's no original PNG left behind to get committed by accident.
async function downloadAsWebp(url, dest) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  const source = Buffer.from(await response.arrayBuffer());

  const webp = await sharp(source)
    // `inside` + withoutEnlargement: shrink anything oversized to fit the
    // target box while keeping its aspect ratio, and leave correctly-sized
    // or smaller grids untouched rather than upscaling them.
    .resize(COVER_WIDTH, COVER_HEIGHT, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer();

  writeFileSync(dest, webp);
  return { from: source.length, to: webp.length };
}

let fetched = 0;
let skipped = 0;
let failed = 0;

for (const game of games) {
  // Skip games with manual cover overrides
  if (game.coverOverride) {
    covers[game.title] = null;
    skipped++;
    continue;
  }

  // Skip already-fetched covers that have a file on disk (unless --force)
  // Null entries (previous misses) are always retried
  if (!force && covers[game.title]) {
    if (existsSync(resolve(coversDir, covers[game.title].file))) {
      skipped++;
      continue;
    }
  }

  try {
    // Search for the game
    const sgdbId = game.sgdbId;
    let gameId = sgdbId;

    if (!gameId) {
      await delay(300);
      const results = await client.searchGame(game.title);
      if (!results || results.length === 0) {
        console.warn(`  [MISS] "${game.title}" - not found on SteamGridDB`);
        covers[game.title] = null;
        failed++;
        continue;
      }
      gameId = results[0].id;
      console.log(`  [FIND] "${game.title}" -> SGDB #${gameId} ("${results[0].name}")`);
    }

    // Get grid images -- prefer 600x900 portrait covers
    await delay(300);
    let grids;
    try {
      grids = await client.getGridsById(gameId, undefined, ['600x900']);
    } catch {
      grids = [];
    }

    // Fallback: any grid if no 600x900 available
    if (!grids || grids.length === 0) {
      try {
        grids = await client.getGridsById(gameId);
      } catch {
        grids = [];
      }
    }

    if (!grids || grids.length === 0) {
      console.warn(`  [MISS] "${game.title}" - no grid images available`);
      covers[game.title] = null;
      failed++;
      continue;
    }

    grids.sort((a, b) => b.score - a.score);
    const bestGrid = grids[0];

    // Download the image. The source extension is deliberately ignored —
    // everything becomes .webp regardless of what SGDB served.
    const imageUrl = bestGrid.url.toString();
    const filename = `${slugify(game.title)}.webp`;
    const destPath = resolve(coversDir, filename);

    const { from, to } = await downloadAsWebp(imageUrl, destPath);

    // Clear out a previous fetch of this cover in another format, so
    // re-running doesn't leave an orphaned .png sitting in the directory
    // that nothing references but Git still carries.
    const previous = covers[game.title]?.file;
    if (previous && previous !== filename) {
      rmSync(resolve(coversDir, previous), { force: true });
    }

    covers[game.title] = {
      sgdbId: gameId,
      file: filename,
      fetchedAt: new Date().toISOString(),
    };

    fetched++;
    const saved = Math.round((1 - to / from) * 100);
    console.log(
      `  [OK]   "${game.title}" -> ${filename}` +
        ` (${Math.round(from / 1024)}KB -> ${Math.round(to / 1024)}KB, -${saved}%)`,
    );
  } catch (err) {
    console.warn(`  [FAIL] "${game.title}" - ${err.message}`);
    covers[game.title] = null;
    failed++;
  }
}

// Write updated manifest
writeFileSync(coversPath, JSON.stringify(covers, null, 2) + '\n');

console.log(`\nDone: ${fetched} fetched, ${skipped} skipped, ${failed} failed`);
console.log(`Manifest: ${coversPath}`);
console.log(`Covers:   ${coversDir}`);
