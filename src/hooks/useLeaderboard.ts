import { useEffect, useState } from 'react';
import type { LeaderboardData } from '../types/game';
import { DATA_BASE } from '../utils/dataBase';

export function useLeaderboard(): { data: LeaderboardData | null; loading: boolean } {
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`${DATA_BASE}data/leaderboard.json`)
      .then((res) => (res.ok ? (res.json() as Promise<LeaderboardData>) : null))
      .then((json) => {
        if (!cancelled) {
          setData(json);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { data, loading };
}
