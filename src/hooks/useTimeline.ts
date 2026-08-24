import { useEffect, useState } from 'react';
import type { TimelineData } from '../types/game';
import { DATA_BASE } from '../utils/dataBase';

export function useTimeline(): { data: TimelineData | null; loading: boolean } {
  const [data, setData] = useState<TimelineData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`${DATA_BASE}data/timeline.json`)
      .then((res) => (res.ok ? (res.json() as Promise<TimelineData>) : null))
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
