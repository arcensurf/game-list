import { readFileSync, readdirSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { computeLeaderboardData } from './build-leaderboard.mjs';

// Precomputes achievement activity over time — monthly totals and a
// per-year rollup — from the same achievements.json + shards that
// build-leaderboard.mjs reads. Kept as its own file/output rather than
// folded into leaderboard.json: the leaderboard is a ranking (recomputed
// whole), this is a time series (grows by appending as new achievements
// land), and the two views have no consumer in common.
const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR
  ? resolve(process.env.DATA_DIR)
  : resolve(__dirname, '..', 'public', 'data');
const achievementsPath = resolve(dataDir, 'achievements.json');
const timelinePath = resolve(dataDir, 'timeline.json');

// Mirrors build-leaderboard.mjs's scoring exactly (see its comment for
// the rationale) — the two must stay in sync.
const PLATFORMS = ['steam', 'psn', 'xbox', 'ra'];
const BASE_POINTS = 10;
const SCORE_CAP = 100;
const TOP_GAMES_PER_YEAR = 10;
const RAREST_PER_YEAR = 3;

// Manual, one-off corrections for games where a platform's earnedAt
// dates are known to be wrong for timeline purposes — not a general
// cross-platform dedup rule (the dupeKey best-single-copy-per-year
// logic below already handles the normal "same game earned twice"
// case). An achievement only counts on the "imported" side if its name
// wasn't already earned (at or before that date) on the source.
//
// Vampire Survivors: the PSN copy is the real 2024 playthrough; the
// Steam copy was bulk-imported from it in 2025, so Steam's earned dates
// reflect the import, not when the achievement was actually unlocked.
//
// Final Fantasy VII Remake: two PSN copies of the same game — the 2020
// PS4 original and the 2021 Intergrade re-release, which re-grants every
// trophy already earned when you carry the save over. The Intergrade
// copy's June 2021 opener is 46 trophies in 46 seconds, all of them
// already earned on the PS4 copy in 2020, and the same echo repeats
// after the 2023 PS4 session. Intergrade-only trophies (the Yuffie DLC,
// the later hard-mode grind) have no PS4 counterpart and still count.
const IMPORT_OVERRIDES = [
  {
    imported: { platform: 'steam', id: '1794680' },
    source: { platform: 'psn', id: 'NPWR42963_00' },
  },
  {
    imported: { platform: 'psn', id: 'NPWR22029_00' },
    source: { platform: 'psn', id: 'NPWR18853_00' },
  },
];

function achievementScore(rarity) {
  if (typeof rarity !== 'number' || rarity <= 0) return null;
  return Math.min(BASE_POINTS * Math.sqrt(100 / rarity), SCORE_CAP);
}

function roundPlatforms(platforms) {
  const out = {};
  for (const [platform, v] of Object.entries(platforms)) {
    out[platform] = { count: v.count, score: Math.round(v.score * 10) / 10 };
  }
  return out;
}

// Two stores selling the same achievement list (Play Anywhere titles,
// mainly) each report the full set as earned, and that isn't twice the
// achievements earned. Collapses a bucket's per-copy tallies to the
// single best copy of each dupeKey group — the same grouping the
// leaderboard's "Hide duplicates" toggle uses.
function bestCopies(games, dupeKeyByGame) {
  const best = new Map();
  for (const g of games) {
    const key = dupeKeyByGame.get(`${g.platform}/${g.id}`) ?? `${g.platform}/${g.id}`;
    const existing = best.get(key);
    if (!existing || g.count > existing.count || (g.count === existing.count && g.score > existing.score)) {
      best.set(key, g);
    }
  }
  return Array.from(best.values());
}

function rollup(games) {
  const totals = { count: 0, score: 0, platforms: {} };
  for (const g of games) {
    totals.count += g.count;
    totals.score += g.score;
    const p = (totals.platforms[g.platform] ??= { count: 0, score: 0 });
    p.count += g.count;
    p.score += g.score;
  }
  return totals;
}

// Rarity always wins — this never promotes a worse rarity over a
// better one. Diversity only breaks EXACT ties: rarity is published
// rounded to one decimal, so a cluster of achievements that display
// as, say, "0.1%" are often several different games' pulls that just
// landed in the same rounded bucket, not one game's DLC sweep. Within
// a tie, one game goes before any game repeats; across tiers, rarity
// order is absolute regardless of which games are already represented.
function pickRarestDiverse(candidates, limit) {
  const sorted = [...candidates].sort((a, b) => a.rarity - b.rarity);

  // Group consecutive equal-rarity entries — sorted, so ties are
  // already adjacent.
  const tiers = [];
  for (const c of sorted) {
    const tier = tiers[tiers.length - 1];
    if (tier && tier.rarity === c.rarity) tier.items.push(c);
    else tiers.push({ rarity: c.rarity, items: [c] });
  }

  const seenGames = new Set();
  const result = [];
  for (const tier of tiers) {
    if (result.length >= limit) break;
    const firstPerGame = [];
    const rest = [];
    const seenThisTier = new Set();
    for (const c of tier.items) {
      const key = `${c.platform}/${c.gameId}`;
      if (!seenGames.has(key) && !seenThisTier.has(key)) {
        seenThisTier.add(key);
        firstPerGame.push(c);
      } else {
        rest.push(c);
      }
    }
    for (const c of [...firstPerGame, ...rest]) {
      if (result.length >= limit) break;
      result.push(c);
      seenGames.add(`${c.platform}/${c.gameId}`);
    }
  }
  return result;
}

// Map of earned achievement name -> earliest earnedAt (ms) for one
// shard, used to look up the IMPORT_OVERRIDES source game.
function loadEarnedNameDates(platform, id) {
  const shardPath = resolve(dataDir, 'achievements', platform, `${id}.json`);
  if (!existsSync(shardPath)) return new Map();
  let shard;
  try {
    shard = JSON.parse(readFileSync(shardPath, 'utf8'));
  } catch {
    return new Map();
  }
  const byName = new Map();
  for (const a of shard.achievements ?? []) {
    if (!a.earned || !a.earnedAt) continue;
    const ms = Date.parse(a.earnedAt);
    if (Number.isNaN(ms)) continue;
    const existing = byName.get(a.name);
    if (existing === undefined || ms < existing) byName.set(a.name, ms);
  }
  return byName;
}

export function computeTimelineData() {
  const summary = JSON.parse(readFileSync(achievementsPath, 'utf8'));
  const monthMap = new Map();
  const yearMap = new Map();

  const importSourceDates = new Map(); // `${platform}/${id}` -> Map<name, ms>
  for (const { imported, source } of IMPORT_OVERRIDES) {
    importSourceDates.set(
      `${imported.platform}/${imported.id}`,
      loadEarnedNameDates(source.platform, source.id),
    );
  }

  // Same title-normalized + game-links.json grouping the leaderboard's
  // "Hide duplicates" toggle uses. Applied to every tally here — month
  // bars, year totals, the platform splits, top games, and the rarest
  // picks — so a game owned twice contributes once wherever it lands.
  const dupeKeyByGame = new Map();
  for (const g of computeLeaderboardData().games) {
    if (g.dupeKey) dupeKeyByGame.set(`${g.platform}/${g.id}`, g.dupeKey);
  }

  for (const platform of PLATFORMS) {
    const dir = resolve(dataDir, 'achievements', platform);
    if (!existsSync(dir)) continue;

    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      const id = file.slice(0, -'.json'.length);

      let shard;
      try {
        shard = JSON.parse(readFileSync(resolve(dir, file), 'utf8'));
      } catch {
        continue;
      }

      const entry = summary[platform]?.[id];
      const title = entry?.title ?? shard.title ?? id;
      const icon = entry?.icon ?? null;
      const sourceDates = importSourceDates.get(`${platform}/${id}`);

      for (const a of shard.achievements ?? []) {
        // Not every earned achievement carries a date — some platforms
        // (Xbox, mainly, for older 360-era titles) return null for
        // earnedAt even when earned is true. Those simply don't
        // contribute to a time series; there's no date to bucket them
        // into.
        if (!a.earned || !a.earnedAt) continue;
        const date = new Date(a.earnedAt);
        if (Number.isNaN(date.getTime())) continue;

        // IMPORT_OVERRIDES: this achievement was already earned on the
        // designated source platform at or before this date, so it's a
        // re-appearance from an import/sync, not a new unlock — skip it
        // entirely rather than double-count the same trophy.
        if (sourceDates) {
          const sourceMs = sourceDates.get(a.name);
          if (sourceMs !== undefined && sourceMs <= date.getTime()) continue;
        }

        const pts = achievementScore(a.rarity) ?? 0;
        const monthKey = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
        const year = date.getUTCFullYear();

        const gameKey = `${platform}/${id}`;

        // Every bucket tallies per copy of the game first and collapses
        // duplicates at rollup, rather than summing as it reads — which
        // copy wins depends on totals that aren't known until the shard
        // is fully read.
        let month = monthMap.get(monthKey);
        if (!month) {
          month = { month: monthKey, games: new Map() };
          monthMap.set(monthKey, month);
        }
        let monthGame = month.games.get(gameKey);
        if (!monthGame) {
          monthGame = { platform, id, count: 0, score: 0 };
          month.games.set(gameKey, monthGame);
        }
        monthGame.count++;
        monthGame.score += pts;

        let yearBucket = yearMap.get(year);
        if (!yearBucket) {
          yearBucket = { year, games: new Map() };
          yearMap.set(year, yearBucket);
        }
        let game = yearBucket.games.get(gameKey);
        if (!game) {
          game = { platform, id, title, icon, count: 0, score: 0, rarestCandidates: [] };
          yearBucket.games.set(gameKey, game);
        }
        game.count++;
        game.score += pts;

        // Rarer = lower rarity%. Not every achievement carries one (a
        // Steam game with no public stats, mainly). Collected as
        // candidates and trimmed to the top N at the end, rather than
        // tracking just the single rarest — a year with several
        // sub-1%-rarity pulls otherwise buries all but one of them.
        // Held per copy so a duplicate's candidates drop out with it:
        // the same trophy carries a different rarity% on each store, so
        // an un-collapsed pair can otherwise take two of the three slots.
        if (typeof a.rarity === 'number') {
          game.rarestCandidates.push({
            platform,
            gameId: id,
            gameTitle: title,
            icon,
            name: a.name,
            rarity: a.rarity,
            earnedAt: a.earnedAt,
          });
        }
      }
    }
  }

  const months = Array.from(monthMap.values())
    .map((m) => {
      const totals = rollup(bestCopies(m.games.values(), dupeKeyByGame));
      return {
        month: m.month,
        count: totals.count,
        score: Math.round(totals.score * 10) / 10,
        platforms: roundPlatforms(totals.platforms),
      };
    })
    .sort((a, b) => a.month.localeCompare(b.month));

  // Ties broken by score, not just count — a year where the top game by
  // achievement count was mostly cheap unlocks shouldn't beat one where
  // fewer, rarer achievements landed for the same count.
  const years = Array.from(yearMap.values())
    .map((y) => {
      const games = bestCopies(y.games.values(), dupeKeyByGame);
      const totals = rollup(games);
      const toEntry = (g) => ({
        platform: g.platform,
        id: g.id,
        title: g.title,
        icon: g.icon,
        count: g.count,
        score: Math.round(g.score * 10) / 10,
      });
      // Two independent rankings, not one list re-sorted client-side —
      // a game with few but rare achievements can out-score something
      // that out-counts it, and re-sorting an already-sliced
      // top-N-by-count list would miss it entirely if it fell outside
      // that cut.
      const topGamesByCount = [...games]
        .sort((a, b) => b.count - a.count || b.score - a.score)
        .slice(0, TOP_GAMES_PER_YEAR)
        .map(toEntry);
      const topGamesByScore = [...games]
        .sort((a, b) => b.score - a.score || b.count - a.count)
        .slice(0, TOP_GAMES_PER_YEAR)
        .map(toEntry);
      return {
        year: y.year,
        count: totals.count,
        score: Math.round(totals.score * 10) / 10,
        platforms: roundPlatforms(totals.platforms),
        topGamesByCount,
        topGamesByScore,
        rarestAchievements: pickRarestDiverse(
          games.flatMap((g) => g.rarestCandidates),
          RAREST_PER_YEAR,
        ),
      };
    })
    .sort((a, b) => a.year - b.year);

  return { months, years };
}

function main() {
  const { months, years } = computeTimelineData();
  const output = { updatedAt: new Date().toISOString(), months, years };
  writeFileSync(timelinePath, JSON.stringify(output));
  console.log(`Wrote ${months.length} months and ${years.length} years to ${timelinePath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
