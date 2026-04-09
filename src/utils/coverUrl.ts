import type { Game, CoverMap } from '../types/game';

export function getCoverUrl(game: Game, covers: CoverMap): string | null {
  if (game.coverOverride) {
    return game.coverOverride;
  }

  const entry = covers[game.title];
  if (entry?.file) {
    return `/covers/${entry.file}`;
  }

  return null;
}
