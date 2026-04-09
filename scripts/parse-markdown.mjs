/**
 * One-time script to parse the existing markdown game list into games.json.
 *
 * Usage: node scripts/parse-markdown.mjs < gamelist.md
 *   or:  node scripts/parse-markdown.mjs path/to/gamelist.md
 *
 * Output: writes src/data/games.json
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, '..', 'src', 'data', 'games.json');

// Read input
const inputPath = process.argv[2];
let md;
if (inputPath) {
  md = readFileSync(resolve(inputPath), 'utf-8');
} else {
  md = readFileSync(0, 'utf-8'); // stdin
}

const lines = md.split('\n');
const games = [];
let currentGame = null;

for (const line of lines) {
  const trimmed = line.trim();

  // Match game title lines: | **Title** ||| Platform ||
  // Also handles: | **Title** (Subtitle) ||| Platform, Platform ||
  // Also handles: | **Title** |||Platform || (no space after pipes)
  const titleMatch = trimmed.match(
    /^\|\s*\*\*(.+?)\*\*\s*(.*?)\s*\|{2,3}\s*(.+?)\s*\|{1,2}\s*$/
  );

  if (titleMatch) {
    const boldTitle = titleMatch[1].trim();
    const suffix = titleMatch[2].trim();

    // Extract parenthetical as subtitle (e.g., "(Story Mode)" -> "Story Mode")
    let title = boldTitle;
    let subtitle = null;
    const parenMatch = suffix.match(/^\((.+)\)$/);
    if (parenMatch) {
      subtitle = parenMatch[1].trim();
    } else if (suffix) {
      // Non-parenthetical suffix stays in the title (e.g., "HD Remaster")
      title = `${boldTitle} ${suffix}`;
    }

    const platformStr = titleMatch[3].replace(/\|/g, '').trim();
    const platforms = platformStr
      .split(',')
      .map(p => p.trim())
      .filter(Boolean);

    currentGame = {
      title,
      subtitle,
      platforms,
      extras: [],
      sgdbId: null,
      coverOverride: null,
    };
    games.push(currentGame);
    continue;
  }

  // Match labeled extra content lines:
  // | &emsp; DLC &#124; Name1, Name2 |||
  // | &emsp; Expansion &#124; Name |||
  // | &emsp; Paths &#124; Name1, Name2 |||
  // | &emsp; Maps &#124; I and II |||
  const extrasMatch = trimmed.match(
    /^\|\s*&emsp;\s*(DLC|Expansions?|Paths?|Maps)\s*&#124;\s*(.+?)\s*\|{2,3}\s*/
  );

  if (extrasMatch && currentGame) {
    const label = extrasMatch[1];
    const items = extrasMatch[2]
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    // Merge into existing group with same label, or create new
    const existing = currentGame.extras.find(e => e.label === label);
    if (existing) {
      existing.items.push(...items);
    } else {
      currentGame.extras.push({ label, items });
    }
    continue;
  }
}

// Sort alphabetically by title (case-insensitive, ignoring leading "The ")
games.sort((a, b) => {
  const normalize = (t) => t.replace(/^the\s+/i, '').toLowerCase();
  return normalize(a.title).localeCompare(normalize(b.title));
});

writeFileSync(outPath, JSON.stringify(games, null, 2) + '\n');
console.log(`Parsed ${games.length} games into ${outPath}`);
