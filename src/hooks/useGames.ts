import { useMemo } from 'react';
import gamesData from '../data/games.json';
import coversData from '../data/covers.json';
import type { Game, CoverMap, GameWithCover, LetterGroup } from '../types/game';
import { getCoverUrl } from '../utils/coverUrl';

const games = gamesData as Game[];
const covers = coversData as CoverMap;

function getGroupLetter(title: string): string {
  const normalized = title.replace(/^the\s+/i, '');
  const first = normalized.charAt(0).toUpperCase();
  if (first >= 'A' && first <= 'Z') {
    return first;
  }
  return '#';
}

export type PlatformStat = { platform: string; count: number };

export function useGames(filter?: string): {
  groups: LetterGroup[];
  totalCount: number;
  platformStats: PlatformStat[];
} {
  return useMemo(() => {
    let filtered = games;

    if (filter) {
      const q = filter.toLowerCase();
      filtered = games.filter(
        (g) =>
          g.title.toLowerCase().includes(q) ||
          g.platforms.some((p) => p.toLowerCase().includes(q)),
      );
    }

    const withCovers: GameWithCover[] = filtered.map((g) => ({
      ...g,
      coverUrl: getCoverUrl(g, covers),
    }));

    const groupMap = new Map<string, GameWithCover[]>();
    for (const game of withCovers) {
      const letter = getGroupLetter(game.title);
      if (!groupMap.has(letter)) {
        groupMap.set(letter, []);
      }
      groupMap.get(letter)!.push(game);
    }

    const letters = Array.from(groupMap.keys()).sort((a, b) => {
      if (a === '#') return -1;
      if (b === '#') return 1;
      return a.localeCompare(b);
    });

    const groups: LetterGroup[] = letters.map((letter) => ({
      letter,
      games: groupMap.get(letter)!,
    }));

    // Platform stats (computed from full list, not filtered)
    const platMap = new Map<string, number>();
    for (const g of games) {
      for (const p of g.platforms) {
        platMap.set(p, (platMap.get(p) || 0) + 1);
      }
    }
    const platformStats: PlatformStat[] = Array.from(platMap.entries())
      .map(([platform, count]) => ({ platform, count }))
      .sort((a, b) => b.count - a.count);

    return { groups, totalCount: withCovers.length, platformStats };
  }, [filter]);
}
