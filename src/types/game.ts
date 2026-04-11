export interface ExtraContent {
  label: string;
  items: string[];
}

export interface Game {
  title: string;
  subtitle: string | null;
  platforms: string[];
  extras: ExtraContent[];
  sgdbId: number | null;
  coverOverride: string | null;
  gameOfGames: string | null;
  order: number;
  steamAppId?: number | null;
  psnNpCommId?: string | null;
  xboxTitleId?: string | null;
}

export interface CoverEntry {
  sgdbId: number | null;
  file: string;
  fetchedAt: string;
}

export type CoverMap = Record<string, CoverEntry | null>;

export interface PlatformAchievementData {
  earned: number;
  total: number;
  platform: 'steam' | 'psn' | 'xbox';
}

export interface GameAchievements {
  platforms: PlatformAchievementData[];
  best: PlatformAchievementData;
  updatedAt: string;
}

// Raw per-platform achievement data, as produced by
// scripts/fetch-achievements.mjs. Keyed by the platform's own ID
// (Steam appid, PSN npCommunicationId, Xbox titleId) so overrides can
// resolve directly and title-based matching can run at render time.
export interface PlatformLibraryEntry {
  title: string;
  earned: number;
  total: number;
  // Only populated for Steam; used as a tie-breaker when multiple
  // Steam entries normalize to the same title.
  playtimeMinutes?: number;
}

export interface AchievementData {
  steam: Record<string, PlatformLibraryEntry>;
  psn: Record<string, PlatformLibraryEntry>;
  xbox: Record<string, PlatformLibraryEntry>;
  updatedAt?: string;
}

export interface GameWithCover extends Game {
  coverUrl: string | null;
  achievements: GameAchievements | null;
}

export interface LetterGroup {
  letter: string;
  games: GameWithCover[];
}
