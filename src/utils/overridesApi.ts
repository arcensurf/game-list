import type { GameOverrides, OverrideStatus } from '../types/overrides';
import { DEFAULT_SKIP_DAYS } from '../types/overrides';
import { DATA_BASE } from './dataBase';

export type ShardPlatform = 'steam' | 'psn' | 'xbox';

const key = (platform: ShardPlatform, id: string) => `${platform}/${id}`;

// Most games never get a mark, so most lookups are misses. Caching them
// matters: the picker asks on every roll, and a miss is indistinguishable
// from a hit as far as the network is concerned.
const cache = new Map<string, GameOverrides | null>();

/**
 * A game's marks, or null when it has none.
 *
 * Note the catch: Vite's dev server answers a missing file under
 * public/ with the SPA fallback — index.html, status 200 — so a plain
 * `res.ok` check isn't enough. Letting res.json() throw on the HTML is
 * what actually detects "no file here".
 */
export async function loadGameOverrides(
  platform: ShardPlatform,
  id: string,
): Promise<GameOverrides | null> {
  const k = key(platform, id);
  const cached = cache.get(k);
  if (cached !== undefined) return cached;

  const data = await fetch(`${DATA_BASE}data/overrides/${k}.json`)
    .then((res) => (res.ok ? (res.json() as Promise<GameOverrides>) : null))
    .catch(() => null);

  cache.set(k, data);
  return data;
}

/**
 * Every game with at least one mark, straight from the dev API — the
 * marks overlay needs the whole set at once, unlike the picker's
 * per-game lookups above. Dev-only, like the write path below.
 */
export async function loadAllOverrides(): Promise<GameOverrides[]> {
  return fetch(`/api/all-overrides?t=${Date.now()}`)
    .then((res) => (res.ok ? (res.json() as Promise<{ games?: GameOverrides[] }>) : null))
    .then((data) => data?.games ?? [])
    .catch(() => []);
}

/**
 * Write a mark through the dev API. Passing `status: null` clears it.
 *
 * Dev-only by construction — the deployed site has no write path, which
 * is why the picker isn't rendered there at all.
 */
export async function saveMark(
  platform: ShardPlatform,
  gameId: string,
  title: string,
  achievementId: string,
  status: OverrideStatus | null,
  days: number = DEFAULT_SKIP_DAYS,
): Promise<GameOverrides | null> {
  const res = await fetch('/api/achievement-override', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ platform, gameId, title, achievementId, status, days }),
  });
  if (!res.ok) {
    throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to save mark');
  }

  const updated = (await res.json()) as GameOverrides;
  // The endpoint prunes expired skips as it writes, so its response is
  // the authoritative post-write state — cache that rather than the
  // local guess at what changed.
  const next = Object.keys(updated.overrides ?? {}).length > 0 ? updated : null;
  cache.set(key(platform, gameId), next);
  return next;
}
