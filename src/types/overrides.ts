// Manual marks the trophy picker puts on individual achievements.
//
// These live in public/data/overrides/<platform>/<gameId>.json, one
// file per game and only for games that actually have a mark, so the
// set stays sparse — unlike the achievement shards next door, which
// are written for every game by the nightly fetch.
//
// The picker is dev-only, so these are written through the dev API and
// pushed to the data branch by /api/publish. Nothing here is stored in
// the browser: a mark has to survive a fresh clone or a cleared cache.
export type OverrideStatus =
  // Earned since the last nightly run. Transient — the fetch script
  // will report it as earned within a day and this becomes redundant.
  | 'earned'
  // Snoozed. Comes back into the pool once `until` passes.
  | 'skipped'
  // Permanently impossible: dead servers, delisted DLC, a defunct
  // leaderboard. Never returns to the pool.
  | 'unachievable';

export interface AchievementOverride {
  status: OverrideStatus;
  /** ISO 8601 timestamp of when the mark was made. */
  at: string;
  /** ISO 8601; only set for `skipped`. */
  until?: string;
}

export interface GameOverrides {
  platform: 'steam' | 'psn' | 'xbox';
  id: string;
  title: string;
  /** Keyed by achievement id, as it appears in the game's shard. */
  overrides: Record<string, AchievementOverride>;
}

export const DEFAULT_SKIP_DAYS = 14;
