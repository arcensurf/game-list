export interface ExtraContent {
  label: string;
  items: string[];
}

export type GameStatus = 'beaten' | 'backlog';

export interface Game {
  title: string;
  subtitle: string | null;
  platforms: string[];
  extras: ExtraContent[];
  sgdbId: number | null;
  coverOverride: string | null;
  gameOfGames: string | null;
  order: number;
  status?: GameStatus;
  steamAppId?: number | null;
  psnNpCommId?: string | null;
  xboxTitleId?: string | null;
  ffxivLodestoneId?: string | null;
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
  platform: 'steam' | 'psn' | 'xbox' | 'ffxiv';
}

// FFXIV-only detail (per-category breakdown + point totals) that
// powers the card's flip face. Normal achievement-bar rendering only
// needs the earned/total aggregate, which lives in the platforms
// array above — this is extra data layered on top.
export interface FfxivCategoryData {
  id: number;
  name: string;
  earned: number;
  total: number;
  pointsEarned: number;
  pointsTotal: number;
}

export interface FfxivCharacterData {
  earned: number;
  total: number;
  pointsEarned: number;
  pointsTotal: number;
  categories: FfxivCategoryData[];
}

export interface GameAchievements {
  platforms: PlatformAchievementData[];
  best: PlatformAchievementData;
  ffxiv?: FfxivCharacterData;
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
  ffxiv?: Record<string, FfxivCharacterData>;
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
