import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { GameOverrides, OverrideStatus } from '../types/overrides';
import { isActive } from '../utils/achievementOverrides';
import { loadAllOverrides, saveMark } from '../utils/overridesApi';
import { loadAchievementList } from '../hooks/useAchievementList';
import { ACHIEVEMENT_PLATFORM_COLORS_LIGHT } from '../utils/platformColors';

const PLATFORM_LABELS: Record<string, string> = {
  steam: 'Steam',
  psn: 'PSN',
  xbox: 'Xbox',
  ra: 'RA',
};

const STATUS_LABELS: Record<OverrideStatus, string> = {
  earned: 'Earned',
  skipped: 'Skipped',
  unachievable: "Can't be earned",
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * A misclick recovery panel: every achievement currently marked
 * earned/skipped/unachievable, drillable per game, with a button to
 * clear one. Reuses the ban overlay's shell — same "search a list,
 * click into a row" shape, just with a game list, then that game's
 * marks, instead of one flat list.
 */
export default function MarksOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [games, setGames] = useState<GameOverrides[]>([]);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<GameOverrides | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [namesLoading, setNamesLoading] = useState(false);

  // Always reopen on the game list, and pull a fresh set — marks made
  // or cleared since the last time this was open (including via Undo)
  // shouldn't leave stale rows behind.
  useEffect(() => {
    if (!open) return;
    setPicked(null);
    setQuery('');
    setLoading(true);
    loadAllOverrides().then((data) => {
      setGames(data);
      setLoading(false);
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Marks only carry an achievement id, so the name comes from the same
  // shard the picker itself reads — fetched on drill-in rather than for
  // every game up front, since most games in the list never get opened.
  useEffect(() => {
    if (!picked) return;
    let cancelled = false;
    setNamesLoading(true);
    loadAchievementList(picked.platform, picked.id).then((list) => {
      if (cancelled) return;
      const map: Record<string, string> = {};
      for (const a of list?.achievements ?? []) map[a.id] = a.name;
      setNames(map);
      setNamesLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [picked]);

  // Expired skips are dead weight, not something to undo — leave them
  // out rather than showing marks that no longer block anything.
  const gameRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return games
      .map((g) => ({
        game: g,
        count: Object.values(g.overrides).filter((m) => isActive(m)).length,
        latest: Object.values(g.overrides).reduce((max, m) => (m.at > max ? m.at : max), ''),
      }))
      .filter((row) => row.count > 0 && (!q || row.game.title.toLowerCase().includes(q)))
      .sort((a, b) => (a.latest < b.latest ? 1 : a.latest > b.latest ? -1 : 0));
  }, [games, query]);

  const achRows = useMemo(() => {
    if (!picked) return [];
    return Object.entries(picked.overrides)
      .filter(([, m]) => isActive(m))
      .sort(([, a], [, b]) => (a.at < b.at ? 1 : -1));
  }, [picked]);

  async function clearMark(achievementId: string) {
    if (!picked) return;
    const updated = await saveMark(picked.platform, picked.id, picked.title, achievementId, null);
    if (updated) {
      setPicked(updated);
      setGames((prev) =>
        prev.map((g) => (g.platform === picked.platform && g.id === picked.id ? updated : g)),
      );
    } else {
      setGames((prev) => prev.filter((g) => !(g.platform === picked.platform && g.id === picked.id)));
      setPicked(null);
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
        aria-label="Marked achievements"
      >
        {!picked ? (
          <>
            <div className="ban-head">
              <h2>Marked achievements</h2>
              <span className="ban-count">{gameRows.length} games</span>
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

            <div className="ban-rows">
              {loading && <p className="ban-empty">Loading...</p>}
              {!loading &&
                gameRows.map(({ game, count }) => (
                  <button
                    className="ban-row marks-row-btn"
                    key={`${game.platform}/${game.id}`}
                    onClick={() => setPicked(game)}
                  >
                    <span
                      className="ban-row-platform"
                      style={{ color: ACHIEVEMENT_PLATFORM_COLORS_LIGHT[game.platform] }}
                    >
                      {PLATFORM_LABELS[game.platform] ?? game.platform}
                    </span>
                    <span className="ban-row-title">{game.title}</span>
                    <span className="ban-row-count">{count} marked</span>
                  </button>
                ))}
              {!loading && gameRows.length === 0 && (
                <p className="ban-empty">Nothing marked right now.</p>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="ban-head">
              <button className="manual-back" onClick={() => setPicked(null)} aria-label="Back to game list">
                ←
              </button>
              <h2>{picked.title}</h2>
              <span className="ban-count">{achRows.length} marked</span>
              <button className="ban-close" onClick={onClose} aria-label="Close">
                ×
              </button>
            </div>

            <div className="ban-rows">
              {namesLoading && <p className="ban-empty">Loading achievement names...</p>}
              {!namesLoading &&
                achRows.map(([id, mark]) => (
                  <div className="ban-row" key={id}>
                    <span className={`marks-status marks-status--${mark.status}`}>
                      {STATUS_LABELS[mark.status]}
                    </span>
                    <span className="ban-row-title">{names[id] ?? id}</span>
                    <span className="ban-row-count">
                      {fmtDate(mark.at)}
                      {mark.status === 'skipped' && mark.until ? ` – ${fmtDate(mark.until)}` : ''}
                    </span>
                    <button className="ban-row-toggle" onClick={() => void clearMark(id)}>
                      Clear
                    </button>
                  </div>
                ))}
              {!namesLoading && achRows.length === 0 && (
                <p className="ban-empty">Nothing left marked in this game.</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
