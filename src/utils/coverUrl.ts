import type { Game, CoverMap } from '../types/game';
import { DATA_BASE } from './dataBase';

export function getCoverUrl(game: Game, covers: CoverMap): string | null {
  if (game.coverOverride) {
    return `${DATA_BASE}${game.coverOverride.replace(/^\//, '')}`;
  }

  const entry = covers[game.title];
  if (entry?.file) {
    return `${DATA_BASE}covers/${entry.file}`;
  }

  return null;
}
