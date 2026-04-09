import type { Game, CoverMap } from '../types/game';

const base = import.meta.env.BASE_URL;

export function getCoverUrl(game: Game, covers: CoverMap): string | null {
  if (game.coverOverride) {
    return `${base}${game.coverOverride.replace(/^\//, '')}`;
  }

  const entry = covers[game.title];
  if (entry?.file) {
    return `${base}covers/${entry.file}`;
  }

  return null;
}
