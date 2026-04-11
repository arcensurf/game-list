import { useMemo, useState, useEffect } from 'react';
import type { Game, CoverMap, AchievementData, GameWithCover, LetterGroup } from '../types/game';
import { getCoverUrl } from '../utils/coverUrl';
import { buildTitleIndex, resolveGameAchievements } from '../utils/achievementMatch';

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

export function useGames(
  filter?: string,
  gogOnly?: boolean,
  perfectOnly?: boolean,
): {
  groups: LetterGroup[];
  totalCount: number;
  platformStats: PlatformStat[];
  loading: boolean;
} {
  const [games, setGames] = useState<Game[]>([]);
  const [covers, setCovers] = useState<CoverMap>({});
  const [achievementData, setAchievementData] = useState<AchievementData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(`${DATA_BASE}data/games.json`).then((r) => r.json()),
      fetch(`${DATA_BASE}data/covers.json`).then((r) => r.json()),
      fetch(`${DATA_BASE}data/achievements.json`).then((r) => r.json()).catch(() => null),
    ]).then(([g, c, a]) => {
      setGames(g as Game[]);
      setCovers(c as CoverMap);
      setAchievementData(a as AchievementData | null);
      setLoading(false);
    });
  }, []);

  // Precomputed title indexes — rebuilt only when achievement data
  // reloads, not on every render. resolveGameAchievements queries these
  // O(1), so iterating ~700 games stays cheap.
  const titleIndex = useMemo(() => buildTitleIndex(achievementData), [achievementData]);

  const result = useMemo(() => {
    let filtered = games;

    if (gogOnly) {
      filtered = filtered.filter((g) => g.gameOfGames);
    }

    if (filter) {
      const q = filter.toLowerCase();
      filtered = filtered.filter(
        (g) =>
          g.title.toLowerCase().includes(q) ||
          g.platforms.some((p) => p.toLowerCase().includes(q)),
      );
    }

    let withCovers: GameWithCover[] = filtered.map((g) => ({
      ...g,
      coverUrl: getCoverUrl(g, covers),
      achievements: resolveGameAchievements(g, achievementData, titleIndex),
    }));

    // Perfect-game filter runs after achievement resolution because it
    // reads the resolved `best` entry rather than any raw field. "Best"
    // already picks the highest-completion platform, so a game that's
    // 100% on PSN and 50% on Steam counts as a perfect game.
    if (perfectOnly) {
      withCovers = withCovers.filter((g) => {
        const best = g.achievements?.best;
        return best != null && best.total > 0 && best.earned === best.total;
      });
    }

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
  }, [games, covers, achievementData, titleIndex, filter, gogOnly, perfectOnly]);

  return { ...result, loading };
}
