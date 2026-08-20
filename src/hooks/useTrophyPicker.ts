import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AchievementData, AchievementEntry } from '../types/game';
import type { GameOverrides, OverrideStatus } from '../types/overrides';
import { DATA_BASE } from '../utils/dataBase';
import { loadAchievementList, type ShardPlatform } from './useAchievementList';
import { eligibleAchievements } from '../utils/achievementOverrides';
import { loadGameOverrides, saveMark } from '../utils/overridesApi';
import { pickerCoverUrl } from '../utils/pickerCover';
import { banKey, loadBannedGames, setGameBanned, type BannedMap } from '../utils/bannedGames';

const PLATFORMS: ShardPlatform[] = ['steam', 'psn', 'xbox'];

// A game the picker can draw from, straight out of achievements.json.
// That file is keyed by the platform's own ID, which is exactly the
// shard path — no title matching needed anywhere in the picker.
interface PoolGame {
  platform: ShardPlatform;
  id: string;
  title: string;
  unearned: number;
  coverUrl: string | null;
}

export interface Roll {
  platform: ShardPlatform;
  gameId: string;
  gameTitle: string;
  coverUrl: string | null;
  achievement: AchievementEntry;
}

// A roll can land on a game whose every remaining achievement turns out
// to be marked, or filtered out by the rarity floor. Neither is knowable
// from the summary counts the weights are built from, so the picker
// re-rolls — bounded, so an aggressive filter can't spin forever. A high
// floor rules out a lot of games, hence the generous ceiling.
const MAX_ATTEMPTS = 60;

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

export function useTrophyPicker(minRarity: number = 0) {
  // Every game with something left to earn, bans included — the manage
  // list needs to show banned games so they can be un-banned.
  const [allGames, setAllGames] = useState<PoolGame[]>([]);
  const [banned, setBanned] = useState<BannedMap>({});
  const [loading, setLoading] = useState(true);
  const [rolling, setRolling] = useState(false);
  const [roll, setRoll] = useState<Roll | null>(null);
  const [marks, setMarks] = useState<GameOverrides | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Games proven empty this session — every remaining achievement is
  // marked or filtered out. Kept out of the pool so repeated rolls
  // don't keep paying for the same dead end.
  const exhausted = useRef<Set<string>>(new Set());

  // "Empty" is relative to the rarity floor, so moving the slider makes
  // every previous verdict stale — a game with nothing above 20% may
  // have plenty above 5%.
  useEffect(() => {
    exhausted.current.clear();
  }, [minRarity]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`${DATA_BASE}data/achievements.json`).then((res) => res.json() as Promise<AchievementData>),
      loadBannedGames(),
    ])
      .then(([data, bans]) => {
        if (cancelled) return;
        setBanned(bans);
        const games: PoolGame[] = [];
        for (const platform of PLATFORMS) {
          for (const [id, entry] of Object.entries(data[platform] ?? {})) {
            const unearned = entry.total - entry.earned;
            if (entry.total > 0 && unearned > 0) {
              games.push({
                platform,
                id,
                title: entry.title,
                unearned,
                coverUrl: pickerCoverUrl(platform, id, entry.icon),
              });
            }
          }
        }
        setAllGames(games);
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

  const pool = useMemo(
    () => allGames.filter((g) => !banned[banKey(g.platform, g.id)]),
    [allGames, banned],
  );

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
        const eligible = list
          ? eligibleAchievements(list.achievements, gameMarks, { minRarity })
          : [];
        if (eligible.length === 0) {
          exhausted.current.add(`${game.platform}/${game.id}`);
          continue;
        }

        setRoll({
          platform: game.platform,
          gameId: game.id,
          gameTitle: list?.title ?? game.title,
          coverUrl: game.coverUrl,
          achievement: eligible[Math.floor(Math.random() * eligible.length)],
        });
        setMarks(gameMarks);
        return;
      }

      setError(
        minRarity > 0
          ? `Nothing found above ${minRarity}% — try lowering the rarity floor.`
          : 'Gave up after 60 tries — try again.',
      );
    } finally {
      setRolling(false);
    }
  }, [pool, minRarity]);

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

  const toggleBan = useCallback(
    async (platform: ShardPlatform, gameId: string, title: string, next: boolean) => {
      try {
        setBanned(await setGameBanned(platform, gameId, title, next));
        // rollTrophy closes over the pool as it was, so a freshly banned
        // game could still be drawn on the very next roll. The exhausted
        // set is a ref, so marking it here takes effect immediately.
        if (next) exhausted.current.add(banKey(platform, gameId));
        else exhausted.current.delete(banKey(platform, gameId));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save ban');
      }
    },
    [],
  );

  /** Ban the game currently on screen, then move on. */
  const banCurrentGame = useCallback(async () => {
    if (!roll) return;
    await toggleBan(roll.platform, roll.gameId, roll.gameTitle, true);
    await rollTrophy();
  }, [roll, toggleBan, rollTrophy]);

  const poolSize = pool.reduce((sum, g) => sum + g.unearned, 0);

  return {
    roll,
    marks,
    loading,
    rolling,
    error,
    poolSize,
    rollTrophy,
    markCurrent,
    allGames,
    banned,
    toggleBan,
    banCurrentGame,
  };
}
