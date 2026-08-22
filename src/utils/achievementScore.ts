// Mirrors the per-achievement scoring in scripts/build-leaderboard.mjs —
// that script runs under Node at fetch time and can't be imported into
// the browser bundle, so the formula is kept here in sync by hand.
// 10 x sqrt(100 / rarity%), capped at 100 (the value at 1% rarity) so a
// handful of sub-1%-rarity achievements can't dominate a game's score.
const BASE_POINTS = 10;
const SCORE_CAP = 100;

export function achievementScore(rarity: number | null | undefined): number | null {
  if (typeof rarity !== 'number' || rarity <= 0) return null;
  return Math.min(BASE_POINTS * Math.sqrt(100 / rarity), SCORE_CAP);
}
