import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

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

const PLATFORMS = ['steam', 'psn', 'xbox', 'ra'];
const BASE_POINTS = 10;
const SCORE_CAP = 100; // = BASE_POINTS * sqrt(100 / 1), i.e. a 1% rarity floor
const PSN_TIER_XP = { bronze: 15, silver: 30, gold: 90, platinum: 300 };
const RAREST_LIMIT = 200;
const GAMES_LIMIT = 100;

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

function main() {
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

  const output = {
    updatedAt: new Date().toISOString(),
    games: games.slice(0, GAMES_LIMIT),
    rarestAchievements: rarestAchievements.slice(0, RAREST_LIMIT),
  };

  writeFileSync(leaderboardPath, JSON.stringify(output));
  console.log(`Wrote ${output.games.length} of ${games.length} scored games and ${output.rarestAchievements.length} rarest achievements to ${leaderboardPath}`);
}

main();
