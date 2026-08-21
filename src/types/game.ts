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
  // Game art from the platform itself (PSN trophy icon, Xbox box art).
  // For Steam this is the real header image resolved via the store API
  // — see fetchSteamHeaderImage in fetch-achievements.mjs — used only as
  // a fallback when the guessed capsule/header URLs 404, since most
  // Steam apps resolve those without needing a network round trip. See
  // utils/pickerCover.ts.
  icon?: string | null;
}

export interface AchievementData {
  steam: Record<string, PlatformLibraryEntry>;
  psn: Record<string, PlatformLibraryEntry>;
  xbox: Record<string, PlatformLibraryEntry>;
  ra: Record<string, PlatformLibraryEntry>;
  ffxiv?: Record<string, FfxivCharacterData>;
  updatedAt?: string;
}

// ── Per-game achievement lists ──
//
// One entry from a shard at
// public/data/achievements/<platform>/<id>.json, written by
// scripts/fetch-achievements.mjs. The full lists run to ~31k entries
// library-wide, far too much for achievements.json, so they're fetched
// one game at a time on demand (see hooks/useAchievementList.ts).
export interface AchievementEntry {
  id: string;
  name: string;
  /** Empty when the platform withholds it for a hidden achievement. */
  description: string;
  hidden: boolean;
  earned: boolean;
  /** ISO 8601, or null when unearned. */
  earnedAt: string | null;
  /**
   * Percentage of players who have unlocked this, to one decimal place.
   * Null where the platform doesn't publish it — Xbox 360 titles on the
   * legacy endpoint, and Steam games with no public stats.
   */
  rarity: number | null;
  /** PSN: bronze / silver / gold / platinum. RA: progression / win_condition / missable. */
  type?: string | null;
  /** Xbox: gamerscore value. RA: point value. */
  points?: number | null;
}

export interface AchievementList {
  platform: 'steam' | 'psn' | 'xbox' | 'ra';
  id: string;
  title: string;
  /** Mirrors the achievements.json summary row for this game. */
  earned: number;
  total: number;
  achievements: AchievementEntry[];
}

export interface GameWithCover extends Game {
  coverUrl: string | null;
  achievements: GameAchievements | null;
}

export interface LetterGroup {
  letter: string;
  games: GameWithCover[];
}
