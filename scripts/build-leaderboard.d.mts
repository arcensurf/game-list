// Hand-written types for the Node-side build script, so the parity
// suite in test/parity.test.ts can import it under `tsc -b` without
// pulling scripts/ into the app's TypeScript program. Only the exports
// the tests and dev-api-plugin use are declared.
import type { AchievementEntry } from '../src/types/game';

export type ScriptPlatform = 'steam' | 'psn' | 'xbox' | 'ra';

export function normalizeTitle(title: string): string;

export function achievementScore(rarity: unknown): number | null;

export function weightedCompletion(
  platform: ScriptPlatform,
  all: Array<Pick<AchievementEntry, 'earned'> & Partial<AchievementEntry>>,
): number;

export interface DupeCandidate {
  platform: string;
  id: string;
  title: string;
  dupeKey?: string | null;
}

/** Mutates each game in place, setting `dupeKey`. */
export function assignDupeKeys(games: DupeCandidate[]): void;

export function topPerPlatform<T extends { platform: string }>(
  rows: T[],
  limit: number,
  keep?: (row: T) => boolean,
): T[];

export function computeLeaderboardData(): {
  games: unknown[];
  rarestAchievements: unknown[];
};
