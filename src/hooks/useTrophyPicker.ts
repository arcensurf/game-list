import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AchievementData, AchievementEntry } from '../types/game';
import type { GameOverrides, OverrideStatus } from '../types/overrides';
import { DATA_BASE } from '../utils/dataBase';
import { loadAchievementList, type ShardPlatform } from './useAchievementList';
import { eligibleAchievements } from '../utils/achievementOverrides';
import { loadGameOverrides, saveMark } from '../utils/overridesApi';
import { pickerCoverUrl } from '../utils/pickerCover';
import { banKey, loadBannedGames, setGameBanned, type BannedMap } from '../utils/bannedGames';

export const PLATFORMS: ShardPlatform[] = ['steam', 'psn', 'xbox'];

// A game the picker can draw from, straight out of achievements.json.
// That file is keyed by the platform's own ID, which is exactly the
// shard path — no title matching needed anywhere in the picker.
interface PoolGame {
  platform: ShardPlatform;
  id: string;
  title: string;
  unearned: number;
  coverUrl: string | null;
  // The platform's own resolved art (Steam's real header image, PSN/Xbox
  // icon). For PSN/Xbox this duplicates coverUrl; for Steam it's the
  // last-resort fallback when the guessed capsule/header URLs 404 — see
  // utils/pickerCover.ts.
  iconUrl: string | null;
}

export interface Roll {
  platform: ShardPlatform;
  gameId: string;
  gameTitle: string;
  coverUrl: string | null;
  iconUrl: string | null;
  achievement: AchievementEntry;
}

// A roll can land on a game whose every remaining achievement turns out
// to be marked, or filtered out by the rarity floor. Neither is knowable
// from the summary counts the weights are built from, so the picker
// re-rolls — bounded, so an aggressive filter can't spin forever. A high
// floor rules out a lot of games, hence the generous ceiling.
const MAX_ATTEMPTS = 60;

// The current roll survives a reload. Losing the achievement you were
// working on to a stray refresh is worse than showing a slightly stale
// one, and this is per-device convenience rather than real state — the
// marks are what get persisted properly, on the data branch.
const STORAGE_KEY = 'game-list:picker-roll';

function readStoredRoll(): Roll | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Roll;
    // Anything without an achievement id predates a format change or is
    // junk; treat it as absent rather than rendering half a card.
    return parsed?.achievement?.id ? parsed : null;
  } catch {
    // Private windows and blocked site data both throw on access.
    return null;
  }
}

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

// One step back per action, so a mis-click doesn't cost you the
// achievement — or, worse, silently leave a permanent "can't be earned"
// on it. Undoing a mark clears the mark too, not just the roll.
interface UndoEntry {
  roll: Roll;
  mark?: { platform: ShardPlatform; gameId: string; achievementId: string };
  ban?: { platform: ShardPlatform; gameId: string; title: string };
}

const UNDO_LIMIT = 10;

export function useTrophyPicker(minRarity: number = 0, enabledPlatforms: ShardPlatform[] = PLATFORMS) {
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

  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);

  // Read inside rollTrophy without making it a dependency — otherwise
  // the callback changes identity on every roll and everything built on
  // top of it churns with it.
  const rollRef = useRef<Roll | null>(null);
  rollRef.current = roll;

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
                iconUrl: entry.icon ?? null,
              });
            }
          }
        }
        setAllGames(games);
        // Restore before the view's auto-roll effect can fire — it only
        // rolls when there's nothing on screen, so a restored roll
        // simply pre-empts it.
        const stored = readStoredRoll();
        if (stored) setRoll(stored);
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

  useEffect(() => {
    if (!roll) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(roll));
    } catch {
      // Not being able to remember the roll is not worth interrupting
      // anyone over.
    }
  }, [roll]);

  const pool = useMemo(
    () =>
      allGames.filter(
        (g) => !banned[banKey(g.platform, g.id)] && enabledPlatforms.includes(g.platform),
      ),
    [allGames, banned, enabledPlatforms],
  );

  // Rarity of every unearned, unmarked achievement across the current
  // pool (bans and platform toggles already applied) — loaded once per
  // pool membership change, not per rarity-slider tick, since the
  // slider itself needs no network round trip once these are in hand.
  // Every shard/override lookup here is the same cached call the roll
  // path already makes, so a game already seen this session costs
  // nothing extra to re-scan.
  const [poolRarities, setPoolRarities] = useState<(number | null)[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPoolRarities(null);
    Promise.all(
      pool.map(async (g) => {
        const [list, marks] = await Promise.all([
          loadAchievementList(g.platform, g.id),
          loadGameOverrides(g.platform, g.id),
        ]);
        if (!list) return [];
        // minRarity: 0 so this stays the rarity-independent eligible
        // set — the floor is applied afterward, against these rarities,
        // so moving the slider never re-triggers this fetch.
        return eligibleAchievements(list.achievements, marks, { minRarity: 0 }).map(
          (a) => a.rarity,
        );
      }),
    ).then((lists) => {
      if (!cancelled) setPoolRarities(lists.flat());
    });
    return () => {
      cancelled = true;
    };
  }, [pool]);

  // Null while poolRarities is still loading — the count below would
  // otherwise flash 0 for whichever games haven't resolved yet.
  const eligibleCount = useMemo(() => {
    if (!poolRarities) return null;
    return poolRarities.filter((r) => minRarity === 0 || r == null || r >= minRarity).length;
  }, [poolRarities, minRarity]);

  const rollTrophy = useCallback(async (undoMeta?: Omit<UndoEntry, 'roll'>) => {
    setRolling(true);
    setError(null);

    const previous = rollRef.current;
    if (previous) {
      setUndoStack((stack) => [...stack.slice(-(UNDO_LIMIT - 1)), { roll: previous, ...undoMeta }]);
    }

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
          iconUrl: game.iconUrl,
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
        await rollTrophy({
          mark: {
            platform: roll.platform,
            gameId: roll.gameId,
            achievementId: roll.achievement.id,
          },
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save mark');
      }
    },
    [roll, rollTrophy],
  );

  /**
   * Load a specific achievement directly, bypassing the weighted draw —
   * for when the random pool isn't going to land on the one you actually
   * need right now. Goes through the same undo stack as a normal roll,
   * just with no mark/ban to reverse.
   */
  const selectManually = useCallback(
    async (
      platform: ShardPlatform,
      gameId: string,
      gameTitle: string,
      coverUrl: string | null,
      iconUrl: string | null,
      achievement: AchievementEntry,
    ) => {
      const previous = rollRef.current;
      if (previous) {
        setUndoStack((stack) => [...stack.slice(-(UNDO_LIMIT - 1)), { roll: previous }]);
      }
      exhausted.current.delete(`${platform}/${gameId}`);
      setError(null);
      setRoll({ platform, gameId, gameTitle, coverUrl, iconUrl, achievement });
      setMarks(await loadGameOverrides(platform, gameId));
    },
    [],
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
    await rollTrophy({
      ban: { platform: roll.platform, gameId: roll.gameId, title: roll.gameTitle },
    });
  }, [roll, toggleBan, rollTrophy]);

  /** Step back to the previous roll, reversing whatever caused the move. */
  const undo = useCallback(async () => {
    const entry = undoStack[undoStack.length - 1];
    if (!entry) return;
    setUndoStack((stack) => stack.slice(0, -1));

    try {
      if (entry.mark) {
        setMarks(
          await saveMark(
            entry.mark.platform,
            entry.mark.gameId,
            entry.roll.gameTitle,
            entry.mark.achievementId,
            null,
          ),
        );
      }
      if (entry.ban) {
        setBanned(
          await setGameBanned(entry.ban.platform, entry.ban.gameId, entry.ban.title, false),
        );
        exhausted.current.delete(banKey(entry.ban.platform, entry.ban.gameId));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to undo');
    }

    // Whatever ruled this game out no longer applies.
    exhausted.current.delete(`${entry.roll.platform}/${entry.roll.gameId}`);
    setRoll(entry.roll);
  }, [undoStack]);

  const poolSize = pool.reduce((sum, g) => sum + g.unearned, 0);

  return {
    roll,
    marks,
    loading,
    rolling,
    error,
    poolSize,
    eligibleCount,
    rollTrophy,
    markCurrent,
    selectManually,
    allGames,
    banned,
    toggleBan,
    banCurrentGame,
    undo,
    canUndo: undoStack.length > 0,
  };
}
