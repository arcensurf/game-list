// Shared achievement-resolution logic for the render path and the
// edit modal. Owns normalization, platform-family eligibility, and the
// override-first title-fallback lookup rule so there's exactly one
// place to change when the matching semantics move.
//
// achievements.json (produced by scripts/fetch-achievements.mjs) is
// the sole runtime source of truth. It contains the full platform
// libraries keyed by platform ID, so an override set on a game points
// directly at an entry — no re-fetch, no re-matching script, no CI
// round-trip required. Title matching runs live over the same maps
// when there's no override for that platform.

import type {
  AchievementData,
  FfxivCharacterData,
  Game,
  GameAchievements,
  PlatformAchievementData,
  PlatformLibraryEntry,
} from '../types/game';

export const PLATFORM_FAMILIES: Record<'steam' | 'psn' | 'xbox', Set<string>> = {
  steam: new Set(['PC']),
  psn: new Set(['PSX', 'PS3', 'PS4', 'PS5', 'PS Vita']),
  xbox: new Set([
    'Xbox 360',
    'Xbox One',
    'Xbox Series X|S',
    'Xbox Series X',
    'Xbox Series S',
  ]),
};

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/[®™©]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function gameHasPlatform(game: Game, platform: keyof typeof PLATFORM_FAMILIES): boolean {
  const family = PLATFORM_FAMILIES[platform];
  return game.platforms.some((p) => family.has(p));
}

// Rank functions decide which entry wins when multiple platform-library
// entries collide on the same normalized title. For Steam we pick the
// one you've actually played (highest playtime). For PSN/Xbox we pick
// the one with the highest completion %, since the "other" entry is
// almost always a demo / trial / different region with 0 progress.
const pctRank = (e: PlatformLibraryEntry) => (e.total > 0 ? e.earned / e.total : 0);
const playtimeRank = (e: PlatformLibraryEntry) => e.playtimeMinutes ?? 0;

// Precomputed normalized-title → entry maps. Expensive to build but
// O(1) to query, so callers that do many lookups (e.g. useGames
// iterating every game on every render) should memoize via
// buildTitleIndex and pass the result to resolveGameAchievements.
export type TitleIndex = {
  steam: Map<string, PlatformLibraryEntry>;
  psn: Map<string, PlatformLibraryEntry>;
  xbox: Map<string, PlatformLibraryEntry>;
};

function buildIndexFor(
  map: Record<string, PlatformLibraryEntry> | undefined,
  rank: (e: PlatformLibraryEntry) => number,
): Map<string, PlatformLibraryEntry> {
  const out = new Map<string, PlatformLibraryEntry>();
  if (!map) return out;
  for (const entry of Object.values(map)) {
    const k = normalizeTitle(entry.title);
    const prev = out.get(k);
    if (!prev || rank(entry) > rank(prev)) out.set(k, entry);
  }
  return out;
}

export function buildTitleIndex(data: AchievementData | null): TitleIndex {
  return {
    steam: buildIndexFor(data?.steam, playtimeRank),
    psn: buildIndexFor(data?.psn, pctRank),
    xbox: buildIndexFor(data?.xbox, pctRank),
  };
}

// Resolve a game's bar data. Override IDs are consulted first: if
// game.psnNpCommId is set and present in raw.psn, that's the PSN entry
// used, period. Otherwise we fall back to a normalized-title lookup
// against the precomputed index. Same for Steam and Xbox.
export function resolveGameAchievements(
  game: Game,
  raw: AchievementData | null,
  index: TitleIndex,
): GameAchievements | null {
  if (!raw) return null;

  const titleNorm = normalizeTitle(game.title);
  const platforms: PlatformAchievementData[] = [];

  // Steam
  if (gameHasPlatform(game, 'steam')) {
    let entry: PlatformLibraryEntry | undefined;
    if (game.steamAppId != null) {
      entry = raw.steam?.[String(game.steamAppId)];
    }
    if (!entry) entry = index.steam.get(titleNorm) ?? undefined;
    if (entry && entry.total > 0) {
      platforms.push({ earned: entry.earned, total: entry.total, platform: 'steam' });
    }
  }

  // PSN
  if (gameHasPlatform(game, 'psn')) {
    let entry: PlatformLibraryEntry | undefined;
    if (game.psnNpCommId) entry = raw.psn?.[game.psnNpCommId];
    if (!entry) entry = index.psn.get(titleNorm) ?? undefined;
    if (entry && entry.total > 0) {
      platforms.push({ earned: entry.earned, total: entry.total, platform: 'psn' });
    }
  }

  // Xbox
  if (gameHasPlatform(game, 'xbox')) {
    let entry: PlatformLibraryEntry | undefined;
    if (game.xboxTitleId) entry = raw.xbox?.[game.xboxTitleId];
    if (!entry) entry = index.xbox.get(titleNorm) ?? undefined;
    if (entry && entry.total > 0) {
      platforms.push({ earned: entry.earned, total: entry.total, platform: 'xbox' });
    }
  }

  // FFXIV — override-only (no title fallback). The Lodestone ID is
  // scoped to a single character, so a title-based lookup would mean
  // nothing. Also exposes the category breakdown on ffxivDetail so
  // the card's flip face can render it.
  let ffxivDetail: FfxivCharacterData | undefined;
  if (game.ffxivLodestoneId) {
    const entry = raw.ffxiv?.[game.ffxivLodestoneId];
    if (entry && entry.total > 0) {
      platforms.push({ earned: entry.earned, total: entry.total, platform: 'ffxiv' });
      ffxivDetail = entry;
    }
  }

  if (platforms.length === 0) return null;

  // Normal "best" is the highest-% platform — the right default
  // because it surfaces the version of a game where the user has
  // made the most progress. But Lodestone achievements are a
  // superset of PSN trophies for FFXIV (PSN only covers main-story
  // expansion gates), so when FFXIV data is present we pin the
  // main bar to it. Otherwise the (much higher-%) PSN trophy entry
  // would dominate and misrepresent the real Lodestone progress.
  const ffxivPlatform = platforms.find((p) => p.platform === 'ffxiv');
  const best = ffxivPlatform ?? platforms.reduce((a, b) => {
    const pctA = a.total > 0 ? a.earned / a.total : 0;
    const pctB = b.total > 0 ? b.earned / b.total : 0;
    return pctB > pctA ? b : a;
  });

  return {
    platforms,
    best,
    ffxiv: ffxivDetail,
    updatedAt: raw.updatedAt ?? new Date().toISOString(),
  };
}
