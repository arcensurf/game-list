import { useEffect, useMemo, useState } from 'react';
import type { CoverMap, Game } from '../types/game';
import { getCoverUrl } from '../utils/coverUrl';
import { DATA_BASE } from '../utils/dataBase';

// Switch and Switch 2 only, for now — every other Nintendo platform in
// the library is tracked through RetroAchievements, so it already shows
// up in the achievement timeline above. These two are the blind spot:
// no achievements at all, so a year of Switch clears would otherwise be
// invisible on this page. Worth widening later if that blind spot
// grows (a future platform with no achievement coverage), not before.
const PLATFORMS = ['Switch', 'Switch 2'];

export interface SwitchBeatenGame {
  title: string;
  coverUrl: string | null;
}

export interface SwitchBeatenYear {
  year: number;
  games: SwitchBeatenGame[];
}

// Fetches games.json + covers.json directly rather than going through
// useGames: that hook's `detailed` mode also merges achievements.json
// and resolves each game's achievement bar, none of which this needs,
// and its `groups` shape is the alphabetical browsing list, not a
// by-year one. Both files are small and already cached from whichever
// other view loaded first.
export function useSwitchBeatenByYear(): { data: SwitchBeatenYear[] | null; loading: boolean } {
  const [games, setGames] = useState<Game[] | null>(null);
  const [covers, setCovers] = useState<CoverMap>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = <T,>(file: string): Promise<T | null> =>
      fetch(`${DATA_BASE}data/${file}`)
        .then((r) => (r.ok ? (r.json() as Promise<T>) : null))
        .catch(() => null);

    Promise.all([load<Game[]>('games.json'), load<CoverMap>('covers.json')]).then(([g, c]) => {
      if (cancelled) return;
      setGames(g);
      if (c) setCovers(c);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const data = useMemo(() => {
    if (!games) return null;
    const byYear = new Map<number, SwitchBeatenGame[]>();
    for (const g of games) {
      if ((g.status ?? 'beaten') !== 'beaten') continue;
      if (!g.beatenAt) continue;
      if (!g.platforms.some((p) => PLATFORMS.includes(p))) continue;
      const year = new Date(g.beatenAt).getUTCFullYear();
      if (!byYear.has(year)) byYear.set(year, []);
      byYear.get(year)!.push({ title: g.title, coverUrl: getCoverUrl(g, covers) });
    }
    return Array.from(byYear.entries())
      .map(([year, list]) => ({ year, games: list }))
      .sort((a, b) => a.year - b.year);
  }, [games, covers]);

  return { data, loading };
}
