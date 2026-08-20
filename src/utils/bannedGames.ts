import { DATA_BASE } from './dataBase';
import type { ShardPlatform } from '../hooks/useAchievementList';

export interface BannedGame {
  title: string;
  at: string;
}

/** Keyed `platform/gameId`, matching the shard paths. */
export type BannedMap = Record<string, BannedGame>;

export const banKey = (platform: ShardPlatform, gameId: string) => `${platform}/${gameId}`;

/**
 * Every banned game, in one request.
 *
 * The picker has to filter its whole pool before it can weight it, so
 * this can't be a per-game lookup the way achievement marks are. The
 * file only ever holds games you've banned by hand, so it stays small.
 *
 * As with the override files, a miss in dev comes back as the SPA
 * fallback (index.html, status 200) — letting res.json() throw is what
 * detects "no bans yet".
 */
export async function loadBannedGames(): Promise<BannedMap> {
  return fetch(`${DATA_BASE}data/overrides/banned.json?t=${Date.now()}`)
    .then((res) => (res.ok ? (res.json() as Promise<{ games?: BannedMap }>) : null))
    .then((data) => data?.games ?? {})
    .catch(() => ({}));
}

/** Toggle a game in or out of the pool. Dev-only, like every write here. */
export async function setGameBanned(
  platform: ShardPlatform,
  gameId: string,
  title: string,
  banned: boolean,
): Promise<BannedMap> {
  const res = await fetch('/api/ban-game', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ platform, gameId, title, banned }),
  });
  if (!res.ok) {
    throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to save ban');
  }
  return ((await res.json()) as { games: BannedMap }).games;
}
