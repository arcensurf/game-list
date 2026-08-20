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
