import type { Game, CoverMap, CoverEntry } from '../types/game';
import { DATA_BASE } from './dataBase';

// A cover's filename is a slug of the game's title — `assassin-s-creed.webp`
// — not a content hash, so re-picking art for a game writes different
// bytes under the same name. The bucket serves covers with a one-year
// `immutable`, which is only honest if the URL changes when the bytes do,
// so the pick timestamp rides along as a version. A browser holding the
// old art asks for a URL it has never seen and gets the new file.
function version(entry: CoverEntry): string {
  const picked = Date.parse(entry.fetchedAt);
  return Number.isNaN(picked) ? '' : `?v=${picked.toString(36)}`;
}

export function getCoverUrl(game: Game, covers: CoverMap): string | null {
  if (game.coverOverride) {
    return `${DATA_BASE}${game.coverOverride.replace(/^\//, '')}`;
  }

  const entry = covers[game.title];
  if (entry?.file) {
    return `${DATA_BASE}covers/${entry.file}${version(entry)}`;
  }

  return null;
}
