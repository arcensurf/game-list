import { useEffect, useState } from 'react';
import type { AchievementData } from '../types/game';
import type { ShardPlatform } from './useAchievementList';
import { DATA_BASE } from '../utils/dataBase';

export interface SearchableGame {
  platform: ShardPlatform;
  id: string;
  title: string;
  icon: string | null;
  earned: number;
  total: number;
}

const PLATFORMS: ShardPlatform[] = ['steam', 'psn', 'xbox', 'ra'];

// Straight out of achievements.json — every scored game, not just the
// per-platform top N that leaderboard.json ships. Backs the leaderboard's
// game search so finding a specific game's score doesn't depend on
// raising that cap.
//
// Deferred behind `enabled` rather than fetched on mount: achievements.json
// runs ~200KB, and the leaderboard renders fine without it — nothing needs
// this list until someone actually focuses the search box, so making it
// wait avoids a second large fetch competing with leaderboard.json for
// bandwidth on every leaderboard visit.
export function useGameSearchIndex(enabled: boolean): { games: SearchableGame[]; loading: boolean } {
  const [games, setGames] = useState<SearchableGame[]>([]);
  // Whether a fetch has resolved (success or failure) — `loading` is
  // derived from this plus `enabled` rather than tracked as its own
  // state set synchronously at the top of the effect.
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch(`${DATA_BASE}data/achievements.json`)
      .then((res) => (res.ok ? (res.json() as Promise<AchievementData>) : null))
      .then((data) => {
        if (cancelled) return;
        if (data) {
          const list: SearchableGame[] = [];
          for (const platform of PLATFORMS) {
            for (const [id, entry] of Object.entries(data[platform] ?? {})) {
              if (entry.earned > 0 && entry.total > 0) {
                list.push({
                  platform,
                  id,
                  title: entry.title,
                  icon: entry.icon ?? null,
                  earned: entry.earned,
                  total: entry.total,
                });
              }
            }
          }
          list.sort((a, b) => a.title.localeCompare(b.title));
          setGames(list);
        }
        setAttempted(true);
      })
      .catch(() => {
        if (!cancelled) setAttempted(true);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { games, loading: enabled && !attempted };
}
