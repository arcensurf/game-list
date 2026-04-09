import type { Game, CoverMap } from '../types/game';

const COVERS_BASE = import.meta.env.DEV
  ? import.meta.env.BASE_URL
  : 'https://raw.githubusercontent.com/arcensurf/game-list/data/public/';

export function getCoverUrl(game: Game, covers: CoverMap): string | null {
  if (game.coverOverride) {
    return `${COVERS_BASE}${game.coverOverride.replace(/^\//, '')}`;
  }

  const entry = covers[game.title];
  if (entry?.file) {
    return `${COVERS_BASE}covers/${entry.file}`;
  }

  return null;
}
