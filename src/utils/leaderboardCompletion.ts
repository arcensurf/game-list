import type { AchievementEntry } from '../types/game';
import type { ShardPlatform } from '../hooks/useAchievementList';
import { achievementScore } from './achievementScore';

// Mirrors weightedCompletion in scripts/build-leaderboard.mjs — kept in
// sync by hand, since that script runs under Node at fetch time and
// can't be imported into the browser bundle. Computed here from the
// same shard data so the modal can show each achievement's actual
// effect on the game's score: an earned one's real contribution (its
// raw value alone overstates it once completion is under 100%), and an
// unearned one's marginal value if picked up next (which also isn't
// just its raw value, since earning it nudges completion itself and
// that in turn scales every already-earned achievement too).
const PSN_TIER_XP: Record<string, number> = { bronze: 15, silver: 30, gold: 90, platinum: 300 };

function psnTierWeight(a: AchievementEntry): number {
  return PSN_TIER_XP[(a.type ?? '').toLowerCase()] ?? PSN_TIER_XP.bronze;
}

function weightFn(
  platform: ShardPlatform,
  achievements: AchievementEntry[],
): (a: AchievementEntry) => number {
  if (platform === 'steam') return () => 1;
  const raw = platform === 'psn' ? psnTierWeight : (a: AchievementEntry) => a.points || 0;
  const total = achievements.reduce((sum, a) => sum + raw(a), 0);
  // No points/tier data to weight by (shouldn't normally happen) — fall
  // back to a flat per-achievement weight rather than divide by zero.
  return total > 0 ? raw : () => 1;
}

export interface GameScoreContext {
  /** Current weighted completion, 0-1. */
  completion: number;
  /** Current game score: sum of earned achievements' raw values, times completion. */
  totalScore: number;
  /** What totalScore would be at 100% completion — every achievement's raw value summed, uncapped by completion. */
  maxScore: number;
  weightOf: (a: AchievementEntry) => number;
  totalWeight: number;
  earnedWeight: number;
  rawScoreEarned: number;
}

export function buildGameScoreContext(
  platform: ShardPlatform,
  achievements: AchievementEntry[],
): GameScoreContext | null {
  if (achievements.length === 0) return null;
  const weightOf = weightFn(platform, achievements);
  const totalWeight = achievements.reduce((sum, a) => sum + weightOf(a), 0);
  if (totalWeight <= 0) return null;

  const earned = achievements.filter((a) => a.earned);
  const earnedWeight = earned.reduce((sum, a) => sum + weightOf(a), 0);
  const rawScoreEarned = earned.reduce((sum, a) => sum + (achievementScore(a.rarity) ?? 0), 0);
  const rawScoreAll = achievements.reduce((sum, a) => sum + (achievementScore(a.rarity) ?? 0), 0);

  // A zero-weight achievement (an xbox/ra entry worth 0 points) adds
  // nothing to either side of this ratio, so a game whose every unearned
  // achievement is worth zero reaches exactly 1 with trophies still
  // outstanding — and completion scales the score, so it would be ranked
  // as a finished game. Fall back to the flat count in just that case;
  // any game where the weights actually discriminate is untouched.
  let completion = earnedWeight / totalWeight;
  if (completion >= 1 && earned.length < achievements.length) {
    completion = earned.length / achievements.length;
  }

  return {
    completion,
    totalScore: rawScoreEarned * completion,
    maxScore: rawScoreAll,
    weightOf,
    totalWeight,
    earnedWeight,
    rawScoreEarned,
  };
}

export interface UnearnedProjection {
  /** This achievement's own value once earned, at the completion rate earning it produces. */
  ownValue: number;
  /** Completion percentage points this achievement would add — its weight's share of the game. */
  completionDeltaPercent: number;
}

// Earning an achievement moves two things at once: its own value joins
// the pool, and completion ticks up by its weight's share of the game
// — which also re-values everything already earned. That second part
// isn't really this achievement's own contribution (it's a retroactive
// bump to *other* rows), so it's surfaced separately here as a
// completion delta rather than folded into one opaque number.
export function projectUnearned(
  ctx: GameScoreContext,
  achievement: AchievementEntry,
): UnearnedProjection | null {
  const raw = achievementScore(achievement.rarity);
  if (raw == null) return null;

  const newCompletion = (ctx.earnedWeight + ctx.weightOf(achievement)) / ctx.totalWeight;
  return {
    ownValue: raw * newCompletion,
    completionDeltaPercent: (newCompletion - ctx.completion) * 100,
  };
}
