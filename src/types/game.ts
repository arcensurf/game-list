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

export type AchievementMap = Record<string, GameAchievements>;

export interface GameWithCover extends Game {
  coverUrl: string | null;
  achievements: GameAchievements | null;
}

export interface LetterGroup {
  letter: string;
  games: GameWithCover[];
}
