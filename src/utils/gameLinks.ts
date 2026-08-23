import { DATA_BASE } from './dataBase';
import { shardKey, type ShardPlatform } from '../hooks/useAchievementList';

export interface GameLinkMember {
  platform: ShardPlatform;
  id: string;
}

/** `[keyA, keyB]`, each `platform/id`, sorted — matches the file on disk. */
export type GameLinkPair = [string, string];

export interface GameLinks {
  merges: GameLinkPair[];
  splits: GameLinkPair[];
}

export const gameLinkKey = (m: GameLinkMember) => shardKey(m.platform, m.id);

/**
 * Manual corrections to the leaderboard's duplicate-game grouping (see
 * assignDupeKeys in scripts/build-leaderboard.mjs, the only thing that
 * actually reads this file). A plain static fetch, same as
 * bannedGames.ts's loadBannedGames — no dev API needed to read it, only
 * to write it.
 */
export async function loadGameLinks(): Promise<GameLinks> {
  return fetch(`${DATA_BASE}data/overrides/game-links.json?t=${Date.now()}`)
    .then((res) => (res.ok ? (res.json() as Promise<Partial<GameLinks>>) : null))
    .then((data) => ({ merges: data?.merges ?? [], splits: data?.splits ?? [] }))
    .catch(() => ({ merges: [], splits: [] }));
}

/**
 * Merge, split, or clear the link between two games. `action: null`
 * removes the pair from whichever list it's currently in. Dev-only,
 * like every write path here.
 */
export async function saveGameLink(
  a: GameLinkMember,
  b: GameLinkMember,
  action: 'merge' | 'split' | null,
): Promise<GameLinks> {
  const res = await fetch('/api/game-links', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ a, b, action }),
  });
  if (!res.ok) {
    throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to save link');
  }
  return (await res.json()) as GameLinks;
}
