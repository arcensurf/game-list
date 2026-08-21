import type { ShardPlatform } from '../hooks/useAchievementList';

// Steam publishes library art at a predictable path, so there's nothing
// to store for it — the appid is the key. The portrait capsule matches
// the shape of the covers used elsewhere in the app; not every app has
// one, which is what STEAM_COVER_FALLBACK is for (header.jpg exists for
// essentially everything, just landscape).
const steamCapsule = (appId: string) =>
  `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900.jpg`;

export const steamCoverFallback = (appId: string) =>
  `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`;

/**
 * Art for a game in the picker pool.
 *
 * Deliberately not covers.json: those are keyed to the curated game
 * list, which covers only about a fifth of the owned library the picker
 * draws from. Each platform's own art covers all of it.
 */
export function pickerCoverUrl(
  platform: ShardPlatform,
  gameId: string,
  icon: string | null | undefined,
): string | null {
  if (platform === 'steam') return steamCapsule(gameId);
  return icon ?? null;
}

// Last resort once every platform-native source has 404'd: the same
// SteamGridDB lookup the curated list's cover picker uses, just
// resolved live instead of picked by hand. Cached per game — a roll
// that lands on the same dead-art game twice in a session shouldn't
// hit SGDB twice, and a game with no match is worth remembering as a
// miss too rather than re-querying every time it comes up.
const fallbackCache = new Map<string, Promise<string | null>>();

export function loadArtFallback(
  platform: ShardPlatform,
  gameId: string,
  title: string,
): Promise<string | null> {
  const key = `${platform}/${gameId}`;
  const cached = fallbackCache.get(key);
  if (cached) return cached;

  const params = new URLSearchParams({ platform, id: gameId, title });
  const request = fetch(`/api/art-fallback?${params}`)
    .then((res) => (res.ok ? (res.json() as Promise<{ url: string | null }>) : null))
    .then((data) => data?.url ?? null)
    .catch(() => null);

  fallbackCache.set(key, request);
  return request;
}
