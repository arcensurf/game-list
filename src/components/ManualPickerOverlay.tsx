import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AchievementEntry } from '../types/game';
import {
  loadAchievementList,
  useAchievementList,
  type ShardPlatform,
} from '../hooks/useAchievementList';
import { eligibleAchievements } from '../utils/achievementOverrides';
import { loadGameOverrides } from '../utils/overridesApi';
import { ACHIEVEMENT_PLATFORM_COLORS_LIGHT } from '../utils/platformColors';

interface ListGame {
  platform: ShardPlatform;
  id: string;
  title: string;
  unearned: number;
  coverUrl: string | null;
}

const PLATFORM_LABELS: Record<string, string> = {
  steam: 'Steam',
  psn: 'PSN',
  xbox: 'Xbox',
};

/**
 * Manual override for when the weighted draw isn't going to land on the
 * one achievement you actually need loaded — pick a game, then pick
 * straight out of its full list. Two steps in one panel rather than two
 * overlays, so backing out of a wrong game doesn't mean reopening
 * anything.
 */
export default function ManualPickerOverlay({
  open,
  onClose,
  games,
  minRarity,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  games: ListGame[];
  minRarity: number;
  onSelect: (
    platform: ShardPlatform,
    gameId: string,
    gameTitle: string,
    coverUrl: string | null,
    achievement: AchievementEntry,
  ) => void;
}) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<ListGame | null>(null);
  const [achQuery, setAchQuery] = useState('');
  // Key of the game currently being rolled, so only its own button shows
  // the pending state while its shard loads.
  const [randomizing, setRandomizing] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);

  // Always reopen on the game list rather than wherever it was left.
  useEffect(() => {
    if (!open) return;
    setPicked(null);
    setQuery('');
    setAchQuery('');
    setPickError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const { list, loading } = useAchievementList(picked?.platform ?? null, picked?.id ?? null);

  const gameRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return games
      .filter((g) => !q || g.title.toLowerCase().includes(q))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [games, query]);

  const achRows = useMemo(() => {
    if (!list) return [];
    const q = achQuery.trim().toLowerCase();
    return list.achievements.filter((a) => !q || a.name.toLowerCase().includes(q));
  }, [list, achQuery]);

  // Locks the game, not the achievement — same as clicking through to
  // the list, just skipping straight to a random pick within it. Draws
  // from the same eligible set a normal roll would (unearned, unmarked,
  // above the rarity floor), so this is a narrowed roll, not a bypass.
  async function pickRandomFor(g: ListGame) {
    const key = `${g.platform}/${g.id}`;
    setRandomizing(key);
    setPickError(null);
    try {
      const [gameList, marks] = await Promise.all([
        loadAchievementList(g.platform, g.id),
        loadGameOverrides(g.platform, g.id),
      ]);
      if (!gameList) {
        setPickError(`No achievement data for ${g.title} yet.`);
        return;
      }
      const eligible = eligibleAchievements(gameList.achievements, marks, { minRarity });
      if (eligible.length === 0) {
        setPickError(
          minRarity > 0
            ? `Nothing in ${g.title} clears the ${minRarity}% rarity floor.`
            : `${g.title} has nothing unearned to roll.`,
        );
        return;
      }
      const achievement = eligible[Math.floor(Math.random() * eligible.length)];
      onSelect(g.platform, g.id, gameList.title, g.coverUrl, achievement);
    } finally {
      setRandomizing(null);
    }
  }

  if (!open) return null;

  return createPortal(
    <div className="ban-overlay" onClick={onClose}>
      <div
        className="ban-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Pick manually"
      >
        {!picked ? (
          <>
            <div className="ban-head">
              <h2>Pick a game</h2>
              <span className="ban-count">{gameRows.length} of {games.length}</span>
              <button className="ban-close" onClick={onClose} aria-label="Close">
                ×
              </button>
            </div>

            <input
              className="ban-search"
              type="search"
              autoFocus
              placeholder="Search games..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />

            {pickError && <p className="manual-pick-error">{pickError}</p>}

            <div className="ban-rows">
              {gameRows.map((g) => {
                const key = `${g.platform}/${g.id}`;
                return (
                  <div className="ban-row" key={key}>
                    <button className="manual-game-btn" onClick={() => setPicked(g)}>
                      <span
                        className="ban-row-platform"
                        style={{ color: ACHIEVEMENT_PLATFORM_COLORS_LIGHT[g.platform] }}
                      >
                        {PLATFORM_LABELS[g.platform] ?? g.platform}
                      </span>
                      <span className="ban-row-title">{g.title}</span>
                      <span className="ban-row-count">{g.unearned} left</span>
                    </button>
                    <button
                      className="manual-random-btn"
                      onClick={() => void pickRandomFor(g)}
                      disabled={randomizing === key}
                      title={`Random unearned achievement from ${g.title}`}
                      aria-label={`Random achievement from ${g.title}`}
                    >
                      {randomizing === key ? '…' : '🎲'}
                    </button>
                  </div>
                );
              })}
              {gameRows.length === 0 && <p className="ban-empty">No games match.</p>}
            </div>
          </>
        ) : (
          <>
            <div className="ban-head">
              <button
                className="manual-back"
                onClick={() => setPicked(null)}
                aria-label="Back to game list"
              >
                ←
              </button>
              <h2>{picked.title}</h2>
              <span className="ban-count">
                {achRows.length} of {list?.achievements.length ?? 0}
              </span>
              <button className="ban-close" onClick={onClose} aria-label="Close">
                ×
              </button>
            </div>

            <input
              className="ban-search"
              type="search"
              autoFocus
              placeholder="Search achievements..."
              value={achQuery}
              onChange={(e) => setAchQuery(e.target.value)}
            />

            <div className="ban-rows">
              {loading && <p className="ban-empty">Loading achievements...</p>}
              {!loading && !list && (
                <p className="ban-empty">No achievement data for this game yet.</p>
              )}
              {!loading &&
                list &&
                achRows.map((a) => (
                  <button
                    key={a.id}
                    className={`ban-row manual-row-btn${a.earned ? ' manual-row-btn--earned' : ''}`}
                    onClick={() =>
                      onSelect(picked.platform, picked.id, list.title, picked.coverUrl, a)
                    }
                  >
                    <span className="manual-ach-name">
                      {a.name}
                      {a.hidden && <span className="picker-hidden">hidden</span>}
                    </span>
                    {a.earned && <span className="manual-ach-badge">Earned</span>}
                  </button>
                ))}
              {!loading && list && achRows.length === 0 && (
                <p className="ban-empty">No achievements match.</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
