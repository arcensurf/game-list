// Prototype: fetches a single Lodestone character's achievement summary
// from FFXIV Collect (https://ffxivcollect.com). Stays out of the main
// fetch-achievements pipeline for now — once the shape is confirmed we
// can fold earned/total into achievements.json under an `ffxiv` key and
// add an override field on the Game type for the Lodestone ID.
//
// FFXIV Collect scrapes the Lodestone, so the character's achievement
// list must be set to public in-game (Character Config → Display
// Settings → Show Achievements to Other Players) and the Lodestone
// profile needs to have synced at least once.

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

try {
  const dotenv = await import('dotenv');
  dotenv.config({ path: resolve(__dirname, '..', '.env.local') });
} catch { /* fine — env vars may come from shell */ }

const LODESTONE_ID = process.argv[2] || process.env.FFXIV_LODESTONE_ID;

if (!LODESTONE_ID) {
  console.error('Usage: node scripts/fetch-ffxiv.mjs <lodestoneId>');
  console.error('   or: FFXIV_LODESTONE_ID=<id> npm run fetch-ffxiv');
  console.error('');
  console.error('Find your ID on the URL of your Lodestone profile page,');
  console.error('e.g. https://na.finalfantasyxiv.com/lodestone/character/12345678/');
  process.exit(1);
}

const base = `https://ffxivcollect.com/api/characters/${LODESTONE_ID}`;

console.log(`Fetching ${base}...\n`);

const res = await fetch(base);
if (!res.ok) {
  console.error(`FFXIV Collect responded ${res.status}: ${await res.text()}`);
  if (res.status === 404) {
    console.error('');
    console.error('404 usually means FFXIV Collect has not synced this character yet.');
    console.error(`Try visiting https://ffxivcollect.com/characters/${LODESTONE_ID} once`);
    console.error('to trigger an initial scrape, then re-run this script.');
  }
  process.exit(1);
}

const data = await res.json();

console.log('── raw response ──');
console.log(JSON.stringify(data, null, 2));
console.log('');

// Best-effort summary — the exact field names will tell us whether we
// need to adjust the integration shape. Prints undefineds rather than
// faking numbers, so we can see what actually came back.
console.log('── summary ──');
console.log(`Character: ${data.name ?? '(missing)'} · ${data.server ?? '(missing)'}`);
console.log(`Last parsed: ${data.last_parsed ?? '(missing)'}`);

const ach = data.achievements;
if (ach) {
  console.log(`Achievements: ${ach.count ?? '?'} / ${ach.total ?? '?'}`);
  if (ach.points_earned != null || ach.points_total != null) {
    console.log(`Points:       ${ach.points_earned ?? '?'} / ${ach.points_total ?? '?'}`);
  }
  if (ach.ranked_points != null) {
    console.log(`Ranked pts:   ${ach.ranked_points}`);
  }
} else {
  console.log('No `achievements` block on response — inspect raw dump above.');
}
