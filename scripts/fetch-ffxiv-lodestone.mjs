// Prototype: scrapes a Lodestone character's achievements directly,
// no third-party intermediary. Kept separate from fetch-ffxiv.mjs so
// the FFXIV Collect prototype remains as a fallback if SE ever
// redesigns the Lodestone and this parser breaks.
//
// The per-category page (/achievement/kind/N/) is the key here — it
// lists every achievement in that category with a data-achieved="0|1"
// attribute, so one request per category gives us earned AND total
// without walking pagination. Eight categories total.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Match fetch-achievements.mjs: DATA_DIR lets CI point at a `data`
// branch checkout. Default is public/data for local runs.
const dataDir = process.env.DATA_DIR
  ? resolve(process.env.DATA_DIR)
  : resolve(__dirname, '..', 'public', 'data');
const achievementsPath = resolve(dataDir, 'achievements.json');

try {
  const dotenv = await import('dotenv');
  dotenv.config({ path: resolve(__dirname, '..', '.env.local') });
} catch { /* env may come from shell */ }

const LODESTONE_ID = process.argv[2] || process.env.FFXIV_LODESTONE_ID;

if (!LODESTONE_ID) {
  console.error('Usage: node scripts/fetch-ffxiv-lodestone.mjs <lodestoneId>');
  console.error('   or: FFXIV_LODESTONE_ID=<id> npm run fetch-ffxiv-lodestone');
  process.exit(1);
}

// Kinds observed in the Lodestone nav: Battle(1), PvP(2), Character(3),
// Items(4), Crafting & Gathering(5), Quests(8), Exploration(11),
// Grand Company(12). The gaps (6, 7, 9, 10) are intentional — SE
// reserved those IDs but never shipped categories for them.
const CATEGORIES = [
  { id: 1, name: 'Battle' },
  { id: 2, name: 'PvP' },
  { id: 3, name: 'Character' },
  { id: 4, name: 'Items' },
  { id: 5, name: 'Crafting & Gathering' },
  { id: 8, name: 'Quests' },
  { id: 11, name: 'Exploration' },
  { id: 12, name: 'Grand Company' },
];

const BASE = `https://na.finalfantasyxiv.com/lodestone/character/${LODESTONE_ID}/achievement`;

// Real-browser UA — Lodestone serves the same HTML to curl regardless,
// but being explicit keeps us out of any future UA-based rate-limiting.
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchCategory(cat) {
  const url = `${BASE}/kind/${cat.id}/`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    throw new Error(`kind ${cat.id}: HTTP ${res.status}`);
  }
  const html = await res.text();

  // Walk each <li class="entry"> block and pull both its data-achieved
  // flag and its point value (entry__achievement__number). The lazy
  // [\s\S]*? between markers keeps each iteration scoped to one entry
  // so points don't cross-contaminate between neighbours.
  const entryRe =
    /<li class="entry"[^>]*data-achieved="(\d)"[\s\S]*?class="entry__achievement__number">(\d+)</g;

  let earned = 0;
  let total = 0;
  let pointsEarned = 0;
  let pointsTotal = 0;
  let m;
  while ((m = entryRe.exec(html)) !== null) {
    const achieved = m[1] === '1';
    const pts = Number(m[2]);
    total += 1;
    pointsTotal += pts;
    if (achieved) {
      earned += 1;
      pointsEarned += pts;
    }
  }

  // js--achievement_size is SE's own count — compare to our parsed
  // total so a silent markup change (regex stops matching, attr
  // renamed, etc.) trips a warning instead of quietly under-reporting.
  const sizeMatch = html.match(/class="js--achievement_size">(\d+)</);
  const declaredTotal = sizeMatch ? Number(sizeMatch[1]) : null;
  if (declaredTotal != null && declaredTotal !== total) {
    console.warn(
      `  ⚠ kind ${cat.id} (${cat.name}): parsed ${total} entries but page declares ${declaredTotal}. ` +
        'Markup may have changed.',
    );
  }

  return { ...cat, earned, total, pointsEarned, pointsTotal };
}

async function fetchTotalPoints() {
  // The character-wide achievement-points header appears on every
  // achievement page. Grab it from the landing page so we don't have
  // to pick one category arbitrarily.
  const res = await fetch(`${BASE}/`, { headers: HEADERS });
  if (!res.ok) return null;
  const html = await res.text();
  const m = html.match(/class="achievement__point">(\d+)</);
  return m ? Number(m[1]) : null;
}

console.log(`Scraping Lodestone character ${LODESTONE_ID}...\n`);

const results = [];
for (const cat of CATEGORIES) {
  process.stdout.write(`  kind/${cat.id} ${cat.name}... `);
  try {
    const r = await fetchCategory(cat);
    results.push(r);
    console.log(`${r.earned}/${r.total} · ${r.pointsEarned}/${r.pointsTotal} pts`);
  } catch (err) {
    console.log(`failed (${err.message})`);
    results.push({
      ...cat,
      earned: 0,
      total: 0,
      pointsEarned: 0,
      pointsTotal: 0,
      error: err.message,
    });
  }
  // Small delay between requests — 8 calls total, so this adds ~4s.
  // Keeps us well clear of any rate-limiting threshold.
  await delay(500);
}

const headerPoints = await fetchTotalPoints();

const earnedSum = results.reduce((a, r) => a + r.earned, 0);
const totalSum = results.reduce((a, r) => a + r.total, 0);
const pointsEarnedSum = results.reduce((a, r) => a + r.pointsEarned, 0);
const pointsTotalSum = results.reduce((a, r) => a + r.pointsTotal, 0);

// The Lodestone header-wide point total ("achievement__point") and our
// summed per-entry earned points should match. Print a warning if they
// diverge — most likely cause is a point-value markup change or an
// achievement we miscounted.
if (headerPoints != null && headerPoints !== pointsEarnedSum) {
  console.warn(
    `\n⚠ Header reports ${headerPoints} earned points but per-entry sum is ${pointsEarnedSum}.`,
  );
}

console.log('\n── summary ──');
console.log(`Achievements: ${earnedSum} / ${totalSum}`);
console.log(`Points:       ${pointsEarnedSum} / ${pointsTotalSum}`);
console.log('');
console.log('By category:');
for (const r of results) {
  const achPct = r.total > 0 ? ((r.earned / r.total) * 100).toFixed(1) : '—';
  const ptPct = r.pointsTotal > 0 ? ((r.pointsEarned / r.pointsTotal) * 100).toFixed(1) : '—';
  console.log(
    `  ${r.name.padEnd(22)} ` +
      `${String(r.earned).padStart(4)}/${String(r.total).padEnd(4)} (${achPct.padStart(5)}%)  ` +
      `${String(r.pointsEarned).padStart(5)}/${String(r.pointsTotal).padEnd(5)} pts (${ptPct.padStart(5)}%)`,
  );
}

// ── Merge into achievements.json ──
//
// Keyed by Lodestone ID so the shape matches steam/psn/xbox (keyed by
// the platform's own ID). An override field on the Game type —
// ffxivLodestoneId — will point at the entry. Only one entry today,
// but keeping the map shape means multi-character support is free
// later, and the resolver code can mirror the other platforms.

if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

const existing = existsSync(achievementsPath)
  ? JSON.parse(readFileSync(achievementsPath, 'utf-8'))
  : { steam: {}, psn: {}, xbox: {} };

existing.ffxiv = {
  ...(existing.ffxiv ?? {}),
  [LODESTONE_ID]: {
    earned: earnedSum,
    total: totalSum,
    pointsEarned: pointsEarnedSum,
    pointsTotal: pointsTotalSum,
    categories: results.map((r) => ({
      id: r.id,
      name: r.name,
      earned: r.earned,
      total: r.total,
      pointsEarned: r.pointsEarned,
      pointsTotal: r.pointsTotal,
    })),
  },
};
existing.updatedAt = new Date().toISOString();

writeFileSync(achievementsPath, JSON.stringify(existing, null, 2) + '\n');
console.log(`\nWrote ${achievementsPath}`);
