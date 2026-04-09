import { useMemo, useState, useEffect } from 'react';
import type { Game, CoverMap, GameWithCover, LetterGroup } from '../types/game';
import { getCoverUrl } from '../utils/coverUrl';

const DATA_BASE = import.meta.env.DEV
  ? import.meta.env.BASE_URL
  : 'https://raw.githubusercontent.com/arcensurf/game-list/data/public/';

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
  loading: boolean;
} {
  const [games, setGames] = useState<Game[]>([]);
  const [covers, setCovers] = useState<CoverMap>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(`${DATA_BASE}data/games.json`).then((r) => r.json()),
      fetch(`${DATA_BASE}data/covers.json`).then((r) => r.json()),
    ]).then(([g, c]) => {
      setGames(g as Game[]);
      setCovers(c as CoverMap);
      setLoading(false);
    });
  }, []);

  const result = useMemo(() => {
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
      games: groupMap.get(letter)!.sort((a, b) => a.order - b.order),
    }));

    // Platform stats (computed from full list, not filtered)
    // Merge regional variants of the same console
    const PLATFORM_ALIASES: Record<string, string> = {
      'Famicom': 'NES + Famicom',
      'NES': 'NES + Famicom',
      'SNES': 'SNES + Super Famicom',
      'Super Famicom': 'SNES + Super Famicom',
    };
    const platMap = new Map<string, number>();
    for (const g of games) {
      for (const p of g.platforms) {
        const key = PLATFORM_ALIASES[p] ?? p;
        platMap.set(key, (platMap.get(key) || 0) + 1);
      }
    }
    const platformStats: PlatformStat[] = Array.from(platMap.entries())
      .map(([platform, count]) => ({ platform, count }))
      .sort((a, b) => b.count - a.count);

    return { groups, totalCount: withCovers.length, platformStats };
  }, [games, covers, filter]);

  return { ...result, loading };
}
