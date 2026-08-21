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
// (Steam appid, PSN npCommunicationId, Xbox titleId, RA GameID) so
// overrides can resolve directly and title-based matching can run at
// render time.
export interface PlatformLibraryEntry {
  title: string;
  earned: number;
  total: number;
  // Only populated for Steam; used as a tie-breaker when multiple
  // Steam entries normalize to the same title.
  playtimeMinutes?: number;
  // Game art from the platform itself (PSN trophy icon, Xbox box art,
  // RA box art). For Steam this is the real header image resolved via
  // the store API — see fetchSteamHeaderImage in fetch-achievements.mjs
  // — used only as a fallback when the guessed capsule/header URLs
  // 404, since most Steam apps resolve those without needing a
  // network round trip. See utils/pickerCover.ts.
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
   * Null where the platform doesn't publish it — Steam games with no
   * public stats being the only regular case (Xbox old-gen titles used
   * to be null too before the contract v3 fix; see the comment above
   * fetchXboxAchievementList in scripts/fetch-achievements.mjs).
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

// ── Leaderboard ──
//
// Precomputed by scripts/build-leaderboard.mjs from achievements.json
// + every shard, and published as public/data/leaderboard.json — the
// scoring formula needs every earned achievement's rarity, which is
// far too much to compute client-side against 500+ individual shard
// fetches on every page load.
export interface LeaderboardGame {
  platform: 'steam' | 'psn' | 'xbox' | 'ra';
  id: string;
  title: string;
  icon: string | null;
  earned: number;
  total: number;
  /** Percent, 1 decimal. Weighted by achievement value where the platform publishes one — see build-leaderboard.mjs. */
  completion: number;
  score: number;
}

export interface LeaderboardAchievement {
  platform: 'steam' | 'psn' | 'xbox' | 'ra';
  gameId: string;
  gameTitle: string;
  icon: string | null;
  name: string;
  rarity: number;
  earnedAt: string | null;
}

export interface LeaderboardData {
  updatedAt: string;
  /** Sorted by score, descending. */
  games: LeaderboardGame[];
  /** Sorted by rarity, ascending. Capped to the rarest 200 — see build-leaderboard.mjs. */
  rarestAchievements: LeaderboardAchievement[];
}

export interface GameWithCover extends Game {
  coverUrl: string | null;
  achievements: GameAchievements | null;
}

export interface LetterGroup {
  letter: string;
  games: GameWithCover[];
}
