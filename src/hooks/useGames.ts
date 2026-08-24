import { useMemo, useState, useEffect, useRef } from 'react';
import type { Game, GameStatus, CoverMap, AchievementData, GameWithCover, LetterGroup } from '../types/game';
import { getCoverUrl } from '../utils/coverUrl';
import { buildTitleIndex, resolveGameAchievements } from '../utils/achievementMatch';
import { DATA_BASE } from '../utils/dataBase';

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
  status: GameStatus = 'beaten',
  // The game grid (List/Backlog) needs covers + achievement data merged
  // into every game; the masthead count and Stats' platformStats only
  // ever need the raw games.json list. Defaulting to true keeps existing
  // callers unchanged — pass false to skip covers.json/achievements.json
  // entirely (~230KB combined) and the per-game merge work, for a view
  // that only reads totalCount/platformStats.
  detailed: boolean = true,
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
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const bust = refreshKey ? `?t=${Date.now()}` : '';
    fetch(`${DATA_BASE}data/games.json${bust}`)
      .then((r) => r.json())
      .then((g) => {
        setGames(g as Game[]);
        setLoading(false);
      });
  }, [refreshKey]);

  // Fetched once the first time a `detailed` view actually needs it,
  // not re-fetched just because `detailed` flips back to true after a
  // view switch — the ref tracks which refreshKey the detail data was
  // last fetched for, so a genuine refresh (dev edits) still re-fetches
  // but toggling views back and forth doesn't.
  const detailFetchedFor = useRef<number | null>(null);
  useEffect(() => {
    if (!detailed || detailFetchedFor.current === refreshKey) return;
    detailFetchedFor.current = refreshKey;
    const bust = refreshKey ? `?t=${Date.now()}` : '';
    Promise.all([
      fetch(`${DATA_BASE}data/covers.json${bust}`).then((r) => r.json()),
      fetch(`${DATA_BASE}data/achievements.json${bust}`).then((r) => r.json()).catch(() => null),
    ]).then(([c, a]) => {
      setCovers(c as CoverMap);
      setAchievementData(a as AchievementData | null);
    });
  }, [detailed, refreshKey]);

  // Re-fetch when dev API calls signal a data change.
  useEffect(() => {
    const handler = () => setRefreshKey((k) => k + 1);
    window.addEventListener('games-updated', handler);
    return () => window.removeEventListener('games-updated', handler);
  }, []);

  // Precomputed title indexes — rebuilt only when achievement data
  // reloads, not on every render. resolveGameAchievements queries these
  // O(1), so iterating ~700 games stays cheap. achievementData stays
  // null when !detailed (never fetched), so this is a cheap no-op in
  // that case rather than something worth gating separately.
  const titleIndex = useMemo(() => buildTitleIndex(achievementData), [achievementData]);

  const result = useMemo(() => {
    // Status filter runs first — backlog games never participate in
    // gog/stats. Games without a status default to 'beaten'.
    let filtered = games.filter((g) => (g.status ?? 'beaten') === status);

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

    let groups: LetterGroup[] = [];
    if (detailed) {
      const withCovers: GameWithCover[] = filtered.map((g) => ({
        ...g,
        coverUrl: getCoverUrl(g, covers),
        achievements: resolveGameAchievements(g, achievementData, titleIndex),
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

      groups = letters.map((letter) => ({
        letter,
        games: groupMap.get(letter)!.sort((a, b) => a.order - b.order),
      }));
    }

    // Platform stats — beaten games only, regardless of view filter.
    // Merge regional variants of the same console. Only needs the raw
    // games list, not covers/achievements — computed regardless of
    // `detailed`.
    const PLATFORM_ALIASES: Record<string, string> = {
      'Famicom': 'NES + Famicom',
      'NES': 'NES + Famicom',
      'SNES': 'SNES + Super Famicom',
      'Super Famicom': 'SNES + Super Famicom',
    };
    const platMap = new Map<string, number>();
    for (const g of games) {
      if ((g.status ?? 'beaten') !== 'beaten') continue;
      for (const p of g.platforms) {
        const key = PLATFORM_ALIASES[p] ?? p;
        platMap.set(key, (platMap.get(key) || 0) + 1);
      }
    }
    const platformStats: PlatformStat[] = Array.from(platMap.entries())
      .map(([platform, count]) => ({ platform, count }))
      .sort((a, b) => b.count - a.count);

    return { groups, totalCount: filtered.length, platformStats };
  }, [games, covers, achievementData, titleIndex, filter, gogOnly, status, detailed]);

  return { ...result, loading };
}
