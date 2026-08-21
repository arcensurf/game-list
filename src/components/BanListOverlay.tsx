import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { banKey, type BannedMap } from '../utils/bannedGames';
import type { ShardPlatform } from '../hooks/useAchievementList';
import { ACHIEVEMENT_PLATFORM_COLORS_LIGHT } from '../utils/platformColors';

interface ListGame {
  platform: ShardPlatform;
  id: string;
  title: string;
  unearned: number;
}

const PLATFORM_LABELS: Record<string, string> = {
  steam: 'Steam',
  psn: 'PSN',
  xbox: 'Xbox',
  ra: 'RA',
};

export default function BanListOverlay({
  open,
  onClose,
  games,
  banned,
  onToggle,
}: {
  open: boolean;
  onClose: () => void;
  games: ListGame[];
  banned: BannedMap;
  onToggle: (platform: ShardPlatform, id: string, title: string, next: boolean) => void;
}) {
  const [query, setQuery] = useState('');

  // Sort order is pinned to how things stood when the panel opened, not
  // to live `banned` state — otherwise banning a game while scrolled
  // partway down yanks it (and everything around it) to the top mid-scroll.
  // Re-sorting only on open still surfaces freshly-banned games next visit.
  const [sortSnapshot, setSortSnapshot] = useState(banned);

  useEffect(() => {
    if (open) setSortSnapshot(banned);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Banned games float to the top so the list doubles as a review of
  // what's already excluded — otherwise un-banning means hunting for a
  // game among several hundred.
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return games
      .filter((g) => !q || g.title.toLowerCase().includes(q))
      .sort((a, b) => {
        const aBanned = sortSnapshot[banKey(a.platform, a.id)] ? 0 : 1;
        const bBanned = sortSnapshot[banKey(b.platform, b.id)] ? 0 : 1;
        if (aBanned !== bBanned) return aBanned - bBanned;
        return a.title.localeCompare(b.title);
      });
  }, [games, sortSnapshot, query]);

  if (!open) return null;

  const bannedCount = Object.keys(banned).length;

  return createPortal(
    <div className="ban-overlay" onClick={onClose}>
      <div
        className="ban-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Banned games"
      >
        <div className="ban-head">
          <h2>Banned games</h2>
          <span className="ban-count">
            {bannedCount} of {games.length} excluded
          </span>
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
          {rows.map((g) => {
            const key = banKey(g.platform, g.id);
            const isBanned = Boolean(banned[key]);
            return (
              <div className={`ban-row${isBanned ? ' ban-row--banned' : ''}`} key={key}>
                <span
                  className="ban-row-platform"
                  style={{ color: ACHIEVEMENT_PLATFORM_COLORS_LIGHT[g.platform] }}
                >
                  {PLATFORM_LABELS[g.platform] ?? g.platform}
                </span>
                <span className="ban-row-title">{g.title}</span>
                <span className="ban-row-count">{g.unearned} left</span>
                <button
                  className="ban-row-toggle"
                  onClick={() => onToggle(g.platform, g.id, g.title, !isBanned)}
                >
                  {isBanned ? 'Un-ban' : 'Ban'}
                </button>
              </div>
            );
          })}
          {rows.length === 0 && <p className="ban-empty">No games match.</p>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
