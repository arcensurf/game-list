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
  /**
   * ISO date (YYYY-MM-DD) the game entered the backlog, stamped by
   * /api/add-game. Only backlog entries carry it — it's what the
   * Backlog view ages each band against. Absent on anything added
   * before the field existed, which the view leaves unstamped.
   */
  addedAt?: string | null;
  /**
   * ISO date (YYYY-MM-DD) the game was marked beaten, stamped by
   * /api/mark-beaten (backlog -> beaten) and by /api/add-game when
   * added directly as beaten. Only stamped going forward — like
   * addedAt, there's no recovering it for a game already beaten
   * before the field existed, which the Stats tab leaves out of any
   * by-year grouping rather than guessing.
   */
  beatenAt?: string | null;
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
  /**
   * Shared by every game build-leaderboard.mjs considers the same
   * title (strict normalized-title match, plus manual overrides in
   * public/data/overrides/game-links.json) — null when this game has
   * no duplicate. Lets the leaderboard view collapse a group down to
   * its highest-scoring member.
   */
  dupeKey: string | null;
  /**
   * Dominant colour of the cover, as a hex string — precomputed by
   * scripts/lib/dominant-color.mjs and cached in
   * public/data/cover-tints.json. Optional because a build may predate
   * the tint pass, or a cover may be unfetchable; the leaderboard falls
   * back to blurring the cover itself when it is absent.
   */
  tint?: string;
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

// ── Achievement timeline ──
//
// Precomputed by scripts/build-timeline.mjs from achievements.json +
// every shard, and published as public/data/timeline.json. Buckets
// every earned achievement with a known earnedAt date (not every
// platform publishes one for every achievement — see the script) by
// month and by year.
export interface TimelinePlatformStat {
  count: number;
  score: number;
}

export interface TimelineMonth {
  /** "YYYY-MM" */
  month: string;
  count: number;
  score: number;
  platforms: Partial<Record<'steam' | 'psn' | 'xbox' | 'ra', TimelinePlatformStat>>;
}

export interface TimelineYearTopGame {
  platform: 'steam' | 'psn' | 'xbox' | 'ra';
  id: string;
  title: string;
  icon: string | null;
  /** Achievements earned in this game during this year specifically. */
  count: number;
  score: number;
}

export interface TimelineYearRarestAchievement {
  platform: 'steam' | 'psn' | 'xbox' | 'ra';
  gameId: string;
  gameTitle: string;
  icon: string | null;
  name: string;
  rarity: number;
  earnedAt: string;
}

// A game that reached earned === total (100%) during this year, keyed
// to the moment its last achievement landed. One entry per dupeKey
// group, same collapsing the top-games rankings use — see
// build-timeline.mjs.
export interface TimelineYearCompletion {
  platform: 'steam' | 'psn' | 'xbox' | 'ra';
  id: string;
  title: string;
  icon: string | null;
  /** Leaderboard's precomputed cover tint, from cover-tints.json — null where unresolved (falls back to a per-platform tint client-side, same as the leaderboard). */
  tint: string | null;
  completedAt: string;
}

export interface TimelineYear {
  year: number;
  count: number;
  score: number;
  platforms: Partial<Record<'steam' | 'psn' | 'xbox' | 'ra', TimelinePlatformStat>>;
  /** Up to 10, ranked by achievements earned that year (ties by score). */
  topGamesByCount: TimelineYearTopGame[];
  /** Up to 10, ranked by points scored that year (ties by count) — an independent ranking, not a re-sort of topGamesByCount. */
  topGamesByScore: TimelineYearTopGame[];
  /** Up to 3 rarest achievements earned that year, sorted rarest first. Empty if none had a published rarity. */
  rarestAchievements: TimelineYearRarestAchievement[];
  /** Games that hit 100% this year, sorted by completion date ascending. */
  completions: TimelineYearCompletion[];
}

export interface TimelineData {
  updatedAt: string;
  /** Sorted ascending, months with zero earned achievements omitted. */
  months: TimelineMonth[];
  /** Sorted ascending by year. */
  years: TimelineYear[];
}

export interface GameWithCover extends Game {
  coverUrl: string | null;
  achievements: GameAchievements | null;
}

export interface LetterGroup {
  letter: string;
  games: GameWithCover[];
}
