import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
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
  failed: boolean;
  retry: () => void;
} {
  const [games, setGames] = useState<Game[]>([]);
  const [covers, setCovers] = useState<CoverMap>({});
  const [achievementData, setAchievementData] = useState<AchievementData | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // games.json gates the whole list, so a failure here has to clear
  // `loading` — otherwise the view sits on "Loading..." forever. The
  // res.ok check matters because a failing origin answers with a body:
  // the Worker returns a plain-text 404, and Vite's dev server answers a
  // missing file under public/ with index.html at status 200. Either
  // reaches r.json() and rejects if it isn't caught here first.
  useEffect(() => {
    let cancelled = false;
    const bust = refreshKey ? `?t=${Date.now()}` : '';
    fetch(`${DATA_BASE}data/games.json${bust}`)
      .then((r) => {
        if (!r.ok) throw new Error(`games.json ${r.status}`);
        return r.json();
      })
      .then((g) => {
        if (cancelled) return;
        setGames(g as Game[]);
        setFailed(false);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
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
    let cancelled = false;
    let settled = false;
    const bust = refreshKey ? `?t=${Date.now()}` : '';
    // Each file settles on its own. Sharing one rejection meant a covers
    // failure also threw away achievements data that had arrived intact,
    // and since the ref above is already claimed for this refreshKey,
    // nothing would ever retry either of them — every card spent the
    // rest of the session with no art and no achievement bar.
    const load = <T,>(file: string): Promise<T | null> =>
      fetch(`${DATA_BASE}data/${file}${bust}`)
        .then((r) => (r.ok ? (r.json() as Promise<T>) : null))
        .catch(() => null);

    Promise.all([load<CoverMap>('covers.json'), load<AchievementData>('achievements.json')]).then(
      ([c, a]) => {
        settled = true;
        if (cancelled) return;
        if (c) setCovers(c);
        setAchievementData(a);
        // Release the claim if covers never arrived, so a later refresh
        // (or a dev edit) gets another go rather than being skipped.
        if (!c) detailFetchedFor.current = null;
      },
    );
    return () => {
      cancelled = true;
      // The claim above is taken before the fetch resolves, so a teardown
      // mid-flight has to give it back. StrictMode makes that the normal
      // case in dev — mount, tear down, remount — and without this the
      // first request is cancelled while the remount skips as "already
      // fetched", leaving covers and achievements permanently unset.
      if (!settled) detailFetchedFor.current = null;
    };
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

  // Shares the refreshKey the dev `games-updated` listener already bumps,
  // so a retry re-runs both fetches through exactly the same path. The
  // spinner has to come back with it, otherwise a second failure never
  // re-renders anything and the button looks dead.
  const retry = useCallback(() => {
    setFailed(false);
    setLoading(true);
    setRefreshKey((k) => k + 1);
  }, []);

  return { ...result, loading, failed, retry };
}
