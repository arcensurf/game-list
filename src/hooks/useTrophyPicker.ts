import { useCallback, useEffect, useRef, useState } from 'react';
import type { AchievementData, AchievementEntry } from '../types/game';
import type { GameOverrides, OverrideStatus } from '../types/overrides';
import { DATA_BASE } from '../utils/dataBase';
import { loadAchievementList, type ShardPlatform } from './useAchievementList';
import { eligibleAchievements } from '../utils/achievementOverrides';
import { loadGameOverrides, saveMark } from '../utils/overridesApi';

const PLATFORMS: ShardPlatform[] = ['steam', 'psn', 'xbox'];

// A game the picker can draw from, straight out of achievements.json.
// That file is keyed by the platform's own ID, which is exactly the
// shard path — no title matching needed anywhere in the picker.
interface PoolGame {
  platform: ShardPlatform;
  id: string;
  title: string;
  unearned: number;
}

export interface Roll {
  platform: ShardPlatform;
  gameId: string;
  gameTitle: string;
  achievement: AchievementEntry;
}

// A roll can land on a game whose every remaining achievement turns out
// to be marked. That can't be known from the summary counts, so the
// picker re-rolls — bounded, so a heavily-marked library can't spin.
const MAX_ATTEMPTS = 25;

/**
 * Weighted pick. Weighting by unearned count and then picking uniformly
 * within the chosen game is exactly uniform across the whole unearned
 * pool: P(t) = (u_g / U) x (1 / u_g) = 1 / U. Games at 100% carry zero
 * weight and drop out on their own.
 */
function pickWeighted(games: PoolGame[]): PoolGame | null {
  const total = games.reduce((sum, g) => sum + g.unearned, 0);
  if (total <= 0) return null;
  let target = Math.random() * total;
  for (const game of games) {
    target -= game.unearned;
    if (target <= 0) return game;
  }
  return games[games.length - 1] ?? null;
}

export function useTrophyPicker() {
  const [pool, setPool] = useState<PoolGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [rolling, setRolling] = useState(false);
  const [roll, setRoll] = useState<Roll | null>(null);
  const [marks, setMarks] = useState<GameOverrides | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Games proven empty this session — every remaining achievement is
  // marked. Kept out of the pool so repeated rolls don't keep paying
  // for the same dead end.
  const exhausted = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    fetch(`${DATA_BASE}data/achievements.json`)
      .then((res) => res.json() as Promise<AchievementData>)
      .then((data) => {
        if (cancelled) return;
        const games: PoolGame[] = [];
        for (const platform of PLATFORMS) {
          for (const [id, entry] of Object.entries(data[platform] ?? {})) {
            const unearned = entry.total - entry.earned;
            if (entry.total > 0 && unearned > 0) {
              games.push({ platform, id, title: entry.title, unearned });
            }
          }
        }
        setPool(games);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError('Could not load achievement data');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const rollTrophy = useCallback(async () => {
    setRolling(true);
    setError(null);

    try {
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const candidates = pool.filter(
          (g) => !exhausted.current.has(`${g.platform}/${g.id}`),
        );
        const game = pickWeighted(candidates);
        if (!game) {
          setRoll(null);
          setError('Nothing left to earn — every achievement is earned or marked.');
          return;
        }

        const [list, gameMarks] = await Promise.all([
          loadAchievementList(game.platform, game.id),
          loadGameOverrides(game.platform, game.id),
        ]);

        // No shard yet (a game added since the last nightly run), or the
        // whole set is spoken for — either way, stop drawing this game.
        const eligible = list ? eligibleAchievements(list.achievements, gameMarks) : [];
        if (eligible.length === 0) {
          exhausted.current.add(`${game.platform}/${game.id}`);
          continue;
        }

        setRoll({
          platform: game.platform,
          gameId: game.id,
          gameTitle: list?.title ?? game.title,
          achievement: eligible[Math.floor(Math.random() * eligible.length)],
        });
        setMarks(gameMarks);
        return;
      }

      setError('Gave up after 25 tries — try again.');
    } finally {
      setRolling(false);
    }
  }, [pool]);

  /** Mark the current roll, then draw a fresh one. */
  const markCurrent = useCallback(
    async (status: OverrideStatus, days?: number) => {
      if (!roll) return;
      try {
        const updated = await saveMark(
          roll.platform,
          roll.gameId,
          roll.gameTitle,
          roll.achievement.id,
          status,
          days,
        );
        setMarks(updated);
        // The game may now be fully spoken for; the next roll finds out.
        exhausted.current.delete(`${roll.platform}/${roll.gameId}`);
        await rollTrophy();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save mark');
      }
    },
    [roll, rollTrophy],
  );

  const poolSize = pool.reduce((sum, g) => sum + g.unearned, 0);

  return { roll, marks, loading, rolling, error, poolSize, rollTrophy, markCurrent };
}
