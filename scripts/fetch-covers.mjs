/**
 * Fetch cover images from SteamGridDB and save them locally.
 *
 * Reads src/data/games.json, checks src/data/covers.json for existing entries,
 * and downloads missing covers to public/covers/.
 *
 * Usage:
 *   npm run fetch-covers              # fetch all missing covers
 *   npm run fetch-covers -- --force   # re-fetch all covers
 *
 * Requires SGDB_API_KEY in .env.local
 */

import dotenv from 'dotenv';
import SGDB from 'steamgriddb';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname, extname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '..', '.env.local') });
const gamesPath = resolve(__dirname, '..', 'src', 'data', 'games.json');
const coversPath = resolve(__dirname, '..', 'src', 'data', 'covers.json');
const coversDir = resolve(__dirname, '..', 'public', 'covers');

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

async function download(url, dest) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(dest, buffer);
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

    // Download the image
    const imageUrl = bestGrid.url.toString();
    const ext = extname(new URL(imageUrl).pathname) || '.png';
    const filename = `${slugify(game.title)}${ext}`;
    const destPath = resolve(coversDir, filename);

    await download(imageUrl, destPath);

    covers[game.title] = {
      sgdbId: gameId,
      file: filename,
      fetchedAt: new Date().toISOString(),
    };

    fetched++;
    console.log(`  [OK]   "${game.title}" -> ${filename}`);
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
