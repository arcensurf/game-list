import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dominantColor } from './lib/dominant-color.mjs';
import { resolve, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

// Precomputes the achievement leaderboard from the data the nightly
// fetch already wrote — achievements.json plus the per-game shards —
// so the public leaderboard view fetches one small file instead of
// making a shard request per game (500+ on a cold visit, straight
// against raw.githubusercontent.com's soft rate limits).
//
// Scoring: each earned achievement scores 10 x sqrt(100 / rarity%),
// capped at 100 pts (the value at 1% rarity) so a handful of
// DLC-only sub-1%-rarity achievements can't single-handedly dominate
// a game's score — see the DRIVECLUB/DIRT5 case that motivated the
// cap. A game's raw score is the sum of that over every earned
// achievement, then multiplied by a completion fraction so a
// fully-cleared game outranks a partial one with a scarier top end.
// Completion is weighted by per-achievement value where the platform
// publishes one (Xbox/RA gamerscore-style points; PSN trophy tier,
// mapped through the standard bronze/silver/gold/platinum XP table)
// so padding a completion percentage with easy unlocks counts for
// less than clearing the achievements that were actually worth more.
// Steam publishes no such weighting, so its completion stays flat
// earned/total.
const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR
  ? resolve(process.env.DATA_DIR)
  : resolve(__dirname, '..', 'public', 'data');
const achievementsPath = resolve(dataDir, 'achievements.json');
const leaderboardPath = resolve(dataDir, 'leaderboard.json');
const gameLinksPath = resolve(dataDir, 'overrides', 'game-links.json');

// Mirrors src/utils/achievementMatch.ts normalizeTitle exactly — the two
// must stay in sync. Scripts can't import the .ts file directly, so this
// is a deliberate duplicate rather than a shared module.
const DIGIT_GLYPHS = {
  'ⅰ': '1', 'ⅱ': '2', 'ⅲ': '3', 'ⅳ': '4', 'ⅴ': '5', 'ⅵ': '6',
  'ⅶ': '7', 'ⅷ': '8', 'ⅸ': '9', 'ⅹ': '10', 'ⅺ': '11', 'ⅻ': '12',
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
  '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
};

function normalizeTitle(title) {
  return title
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/[®™©]/g, '')
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹ⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹⅺⅻ]/g, (ch) => DIGIT_GLYPHS[ch])
    .replace(/[^a-z0-9]/g, '');
}

// Union-find over "platform/id" keys, used to group same-title games
// (regardless of platform) into duplicate clusters — see buildDupeKeys.
function makeUnionFind(keys) {
  const parent = new Map(keys.map((k) => [k, k]));
  function find(k) {
    while (parent.get(k) !== k) {
      parent.set(k, parent.get(parent.get(k)));
      k = parent.get(k);
    }
    return k;
  }
  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }
  return { find, union };
}

// Games played on more than one platform (or under more than one ID on
// the same platform — e.g. a disc release and its GFWL/Steam re-listing)
// show up as separate rows with separate scores. Grouping them lets the
// leaderboard view offer a "hide duplicates" toggle that keeps only the
// highest-scoring member of each group. Matching is strict normalized-
// title equality — deliberately not fuzzy, so e.g. "Final Fantasy VII"
// and "Final Fantasy VII Remake" never collide — with a small manual
// override file for the cases that need a human call either way:
// public/data/overrides/game-links.json, written through the dev-only
// /api/game-links route (see dev-api-plugin.ts) and published the same
// way as banned.json.
function assignDupeKeys(games) {
  const keyOf = (g) => `${g.platform}/${g.id}`;
  const byKey = new Map(games.map((g) => [keyOf(g), g]));
  const keys = games.map(keyOf);

  let links = { merges: [], splits: [] };
  if (existsSync(gameLinksPath)) {
    try {
      links = JSON.parse(readFileSync(gameLinksPath, 'utf8'));
    } catch {
      // Malformed override file: proceed with title-matching alone
      // rather than failing the whole nightly build over it.
    }
  }
  const splitPairs = new Set(
    (links.splits ?? []).map(([a, b]) => [a, b].sort().join('|')),
  );

  const uf = makeUnionFind(keys);

  const buckets = new Map();
  for (const g of games) {
    const norm = normalizeTitle(g.title);
    const list = buckets.get(norm) ?? [];
    list.push(keyOf(g));
    buckets.set(norm, list);
  }
  for (const bucket of buckets.values()) {
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const pairKey = [bucket[i], bucket[j]].sort().join('|');
        if (splitPairs.has(pairKey)) continue;
        uf.union(bucket[i], bucket[j]);
      }
    }
  }

  // Manual merges always win, even over a split on the same pair — a
  // merge is a deliberate, more specific action than a split.
  for (const [a, b] of links.merges ?? []) {
    if (byKey.has(a) && byKey.has(b)) uf.union(a, b);
  }

  const groupSize = new Map();
  for (const k of keys) {
    const root = uf.find(k);
    groupSize.set(root, (groupSize.get(root) ?? 0) + 1);
  }
  for (const k of keys) {
    const root = uf.find(k);
    byKey.get(k).dupeKey = groupSize.get(root) >= 2 ? root : null;
  }
}

const PLATFORMS = ['steam', 'psn', 'xbox', 'ra'];
const BASE_POINTS = 10;
const SCORE_CAP = 100; // = BASE_POINTS * sqrt(100 / 1), i.e. a 1% rarity floor
const PSN_TIER_XP = { bronze: 15, silver: 30, gold: 90, platinum: 300 };
// Per platform, not overall — the leaderboard view lets visitors filter
// down to one platform, and a global top-100/200 cut here would starve
// that filter down to whatever fraction of, say, RA happened to make
// the global cut. Keeping each platform's own top N guarantees any
// single-platform (or combined) view has a full list to slice from; see
// topPerPlatform below and the client-side re-slice in LeaderboardView.
const RAREST_LIMIT_PER_PLATFORM = 200;
const GAMES_LIMIT_PER_PLATFORM = 100;

// Rows must already be sorted into the desired order — this preserves
// that order within each platform's slice, it doesn't re-sort. `keep`
// marks rows that ride along past the limit without counting against
// it; see the games call below.
function topPerPlatform(rows, limit, keep) {
  const byPlatform = new Map();
  const counts = new Map();
  for (const row of rows) {
    const ranked = (counts.get(row.platform) ?? 0) < limit;
    if (!ranked && !keep?.(row)) continue;
    const list = byPlatform.get(row.platform) ?? [];
    list.push(row);
    byPlatform.set(row.platform, list);
    if (ranked) counts.set(row.platform, (counts.get(row.platform) ?? 0) + 1);
  }
  return PLATFORMS.flatMap((p) => byPlatform.get(p) ?? []);
}

function achievementScore(rarity) {
  if (typeof rarity !== 'number' || rarity <= 0) return null;
  return Math.min(BASE_POINTS * Math.sqrt(100 / rarity), SCORE_CAP);
}

function psnTierWeight(achievement) {
  return PSN_TIER_XP[(achievement.type ?? '').toLowerCase()] ?? PSN_TIER_XP.bronze;
}

function weightedCompletion(platform, all) {
  if (platform === 'steam') {
    return all.length > 0 ? all.filter((a) => a.earned).length / all.length : 0;
  }
  const weight = platform === 'psn' ? psnTierWeight : (a) => a.points || 0;
  const total = all.reduce((sum, a) => sum + weight(a), 0);
  if (total <= 0) {
    // No points/tier data to weight by (shouldn't normally happen) —
    // fall back to a flat count rather than divide by zero.
    return all.length > 0 ? all.filter((a) => a.earned).length / all.length : 0;
  }
  const earned = all.filter((a) => a.earned).reduce((sum, a) => sum + weight(a), 0);
  return earned / total;
}

// The full, unsliced game list (every earned game with a positive score,
// deduped) plus rarest achievements — exported so dev-api-plugin.ts can
// reuse it for the "Review duplicates" overlay. leaderboard.json itself
// only ships each platform's top N (topPerPlatform, below), which is
// fine for the public leaderboard but means a real duplicate can go
// invisible to that review tool if one side scores too low to make the
// cut — this gives it the full picture instead.
export function computeLeaderboardData() {
  const summary = JSON.parse(readFileSync(achievementsPath, 'utf8'));
  const games = [];
  const rarestAchievements = [];

  for (const platform of PLATFORMS) {
    const lib = summary[platform] ?? {};
    for (const [id, entry] of Object.entries(lib)) {
      if (!entry.earned || entry.total <= 0) continue;

      const shardPath = resolve(dataDir, 'achievements', platform, `${id}.json`);
      if (!existsSync(shardPath)) continue;
      let shard;
      try {
        shard = JSON.parse(readFileSync(shardPath, 'utf8'));
      } catch {
        continue;
      }
      const all = shard.achievements ?? [];

      let rawScore = 0;
      for (const a of all) {
        if (!a.earned) continue;
        const pts = achievementScore(a.rarity);
        if (pts != null) rawScore += pts;
        if (pts != null && typeof a.rarity === 'number') {
          rarestAchievements.push({
            platform,
            gameId: id,
            gameTitle: entry.title,
            icon: entry.icon ?? null,
            name: a.name,
            rarity: a.rarity,
            earnedAt: a.earnedAt ?? null,
          });
        }
      }
      if (rawScore <= 0) continue;

      const completion = weightedCompletion(platform, all);
      games.push({
        platform,
        id,
        title: entry.title,
        icon: entry.icon ?? null,
        earned: entry.earned,
        total: entry.total,
        completion: Math.round(completion * 1000) / 10, // percent, 1 decimal
        score: Math.round(rawScore * completion * 10) / 10,
      });
    }
  }

  games.sort((a, b) => b.score - a.score);
  rarestAchievements.sort((a, b) => a.rarity - b.rarity);
  assignDupeKeys(games);

  return { games, rarestAchievements };
}

// Cover tints for the leaderboard's completion wash.
//
// The view used to blur the cover behind a finished row to colour it.
// Blur averages whatever is in frame, so the tint came out of the
// composition rather than the art — dark skies and letterboxing pulled it
// to mud, and a wide crop of a portrait cover samples a middle band that
// often misses the subject entirely. Choosing the colour deliberately
// fixes both, and it moves the work off the page: one hex per game
// instead of a hundred blurred images decoded on every visit.
//
// Cached by platform/id, because resolving a tint means fetching the
// cover. Only games the cache has never seen cost a request, so a
// re-run after a nightly fetch touches the handful that are new.
async function attachTints(games, dataDir) {
  const cachePath = resolve(dataDir, 'cover-tints.json');
  // Bump when dominant-color.mjs changes how it picks, so a stored tint is
  // never a result the current algorithm would not produce. Cheap to get
  // wrong silently and annoying to debug: the code looks fixed and the
  // page still shows the old colour.
  // 6: coverUrlsFor gained the Steam header fallback. The version has to
  // move for a source change too, not just an algorithm one — the cached
  // nulls are "no cover found", and without a bump the games the new
  // fallback exists to rescue would keep serving their stored null.
  const TINT_ALGO_VERSION = 6;
  const stored = existsSync(cachePath)
    ? JSON.parse(readFileSync(cachePath, 'utf8'))
    : {};
  const cache =
    stored.version === TINT_ALGO_VERSION && stored.tints ? stored.tints : {};
  if (!Object.keys(cache).length && Object.keys(stored).length) {
    console.log('[leaderboard] tint algorithm changed; recomputing every cover');
  }

  let sharp;
  try {
    ({ default: sharp } = await import('sharp'));
  } catch {
    // Tints are an enhancement, not a requirement — the view falls back
    // to the blurred cover when one is missing.
    console.warn('[leaderboard] sharp unavailable; skipping cover tints');
    return;
  }

  let fetched = 0;
  let failed = 0;
  for (const game of games) {
    const key = `${game.platform}/${game.id}`;
    if (!(key in cache)) {
      let tint = null;
      for (const url of coverUrlsFor(game)) {
        try {
          const res = await fetch(url);
          if (!res.ok) continue;
          tint = await dominantColor(Buffer.from(await res.arrayBuffer()), sharp);
          fetched++;
          if (tint) break;
        } catch {
          failed++;
        }
      }
      // A null is cached deliberately: a cover that 404s today will
      // 404 tomorrow, and re-fetching it every build is the whole
      // cost this cache exists to avoid.
      cache[key] = tint;
    }
    if (cache[key]) game.tint = cache[key];
  }

  writeFileSync(cachePath, JSON.stringify({ version: TINT_ALGO_VERSION, tints: cache }, null, 2));
  const hit = games.filter((g) => g.tint).length;
  console.log(`[leaderboard] tints: ${hit}/${games.length} (${fetched} fetched, ${failed} failed)`);
}

// Mirrors src/utils/pickerCover.ts — Steam art is derived from the appid,
// every other platform ships an icon URL with the achievement data.
//
// Steam gets two candidates, tried in order. The portrait library capsule
// is the better source and what the app itself shows, but Steam only ever
// generated it for titles that were current when the format landed: of the
// covers this build could not resolve, every single Steam one 404s on
// library_600x900 while most still serve the old landscape header. Since a
// tint is colour statistics rather than a picture — dominant-color.mjs
// resizes with fit:'fill', so aspect ratio is irrelevant — the header is a
// perfectly good second source for the one thing it's used for here.
function coverUrlsFor(game) {
  if (game.platform === 'steam') {
    const base = `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${game.id}`;
    return [`${base}/library_600x900.jpg`, `${base}/header.jpg`];
  }
  return game.icon ? [game.icon] : [];
}

async function main() {
  const { games, rarestAchievements } = computeLeaderboardData();

  const output = {
    updatedAt: new Date().toISOString(),
    // Completions ride along past the cap: the leaderboard's
    // "completions only" filter is meant to be the whole trophy case,
    // and every 100% game currently clears the cut on score alone —
    // but a short game with common achievements needn't, and a filter
    // that silently drops one is worse than no filter.
    games: topPerPlatform(games, GAMES_LIMIT_PER_PLATFORM, (g) => g.earned === g.total),
    rarestAchievements: topPerPlatform(rarestAchievements, RAREST_LIMIT_PER_PLATFORM),
  };

  // After the cut, so a build only resolves tints for games that ship.
  await attachTints(output.games, dataDir);

  writeFileSync(leaderboardPath, JSON.stringify(output));
  console.log(`Wrote ${output.games.length} of ${games.length} scored games and ${output.rarestAchievements.length} of ${rarestAchievements.length} rarest achievements to ${leaderboardPath}`);
}

// Only run when executed directly (`node build-leaderboard.mjs` / npm
// script) — not when dev-api-plugin.ts imports computeLeaderboardData,
// which would otherwise re-run the whole build (and overwrite
// leaderboard.json) as a side effect of every dev-server request.
// process.argv[1] is unset in some invocation shapes (e.g. `node -e`),
// so guard rather than let pathToFileURL throw on undefined.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // main() is async now (the tint pass fetches covers), so an unhandled
  // rejection would otherwise exit 0 and silently ship a stale file.
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
