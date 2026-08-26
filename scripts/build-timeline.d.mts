// See the note in build-leaderboard.d.mts — hand-written types covering
// only the exports the tests reach for.
export function achievementScore(rarity: unknown): number | null;

export interface PlatformTally {
  count: number;
  score: number;
}

export function roundPlatforms(
  platforms: Record<string, PlatformTally>,
): Record<string, PlatformTally>;

export interface TimelineGame {
  platform: string;
  id: string;
  count: number;
  score: number;
}

/** Collapses each dupeKey group to its single best copy. */
export function bestCopies<T extends TimelineGame>(
  games: T[],
  dupeKeyByGame: Map<string, string>,
): T[];

export function rollup(
  games: TimelineGame[],
): PlatformTally & { platforms: Record<string, PlatformTally> };

export interface RarestCandidate {
  platform: string;
  gameId: string;
  rarity: number;
}

export function pickRarestDiverse<T extends RarestCandidate>(candidates: T[], limit: number): T[];

export function computeTimelineData(): { months: unknown[]; years: unknown[] };
