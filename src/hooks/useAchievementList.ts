import { useEffect, useState } from 'react';
import type { AchievementList } from '../types/game';
import { DATA_BASE } from '../utils/dataBase';

export type ShardPlatform = 'steam' | 'psn' | 'xbox' | 'ra';

// Shards only change when the nightly fetch runs, and in production
// they're served from raw.githubusercontent.com (five-minute cache,
// soft rate limits), so a module-level cache is worth having: a random
// picker that lands on the same game twice shouldn't hit the network
// twice. `inFlight` collapses concurrent requests for the same shard
// into one — two cards mounting at once is otherwise two fetches.
const cache = new Map<string, AchievementList | null>();
const inFlight = new Map<string, Promise<AchievementList | null>>();

export const shardKey = (platform: ShardPlatform, id: string) => `${platform}/${id}`;

/**
 * Fetch one game's achievement list. Resolves to null when the game has
 * no shard — plenty of library entries have no achievements at all, and
 * a game only gets a shard once the fetch script has seen it.
 */
export function loadAchievementList(
  platform: ShardPlatform,
  id: string,
): Promise<AchievementList | null> {
  const key = shardKey(platform, id);

  const cached = cache.get(key);
  if (cached !== undefined) return Promise.resolve(cached);

  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = fetch(`${DATA_BASE}data/achievements/${key}.json`)
    .then((res) => (res.ok ? (res.json() as Promise<AchievementList>) : null))
    .catch(() => null)
    .then((data) => {
      cache.set(key, data);
      inFlight.delete(key);
      return data;
    });

  inFlight.set(key, request);
  return request;
}

/**
 * Hook wrapper around loadAchievementList. Pass a null platform or id to
 * hold off fetching (e.g. a picker that hasn't rolled a game yet).
 */
export function useAchievementList(
  platform: ShardPlatform | null,
  id: string | null,
): { list: AchievementList | null; loading: boolean } {
  const key = platform && id ? shardKey(platform, id) : null;
  // State carries the key its list belongs to, so "still loading" is
  // derived rather than set. Flipping a loading flag synchronously in
  // the effect would render one frame of stale data for the previous
  // game before the new fetch lands.
  const [resolved, setResolved] = useState<{
    key: string | null;
    list: AchievementList | null;
  }>({ key: null, list: null });

  useEffect(() => {
    if (!platform || !id) return;
    let cancelled = false;
    loadAchievementList(platform, id).then((data) => {
      if (!cancelled) setResolved({ key: shardKey(platform, id), list: data });
    });
    return () => {
      cancelled = true;
    };
  }, [platform, id]);

  const settled = resolved.key === key;
  return {
    list: settled ? resolved.list : null,
    loading: key !== null && !settled,
  };
}
