import { useState } from 'react';
import type { GameWithCover } from '../types/game';
import PlatformBadge from './PlatformBadge';
import DevEditControls from './DevEditControls';
import CoverPicker from './CoverPicker';

const isDev = import.meta.env.DEV;

export default function BacklogList({ games }: { games: GameWithCover[] }) {
  const sorted = [...games].sort((a, b) => {
    const norm = (t: string) => t.replace(/^the\s+/i, '').toLowerCase();
    return norm(a.title).localeCompare(norm(b.title));
  });

  if (sorted.length === 0) {
    return (
      <p className="backlog-empty">
        No games in the backlog.
      </p>
    );
  }

  return (
    <ul className="backlog-list">
      {sorted.map((game) => (
        <BacklogRow key={game.title} game={game} />
      ))}
    </ul>
  );
}

function BacklogRow({ game }: { game: GameWithCover }) {
  const [pickerOpen, setPickerOpen] = useState(false);

  const handleMarkBeaten = async () => {
    if (!confirm(`Mark "${game.title}" as beaten?`)) return;
    const res = await fetch('/api/mark-beaten', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: game.title }),
    });
    if (res.ok) {
      window.dispatchEvent(new Event('games-updated'));
    }
  };

  return (
    <li className="backlog-row">
      <div className="backlog-cover">
        {game.coverUrl ? (
          <img src={game.coverUrl} alt="" loading="lazy" />
        ) : (
          <div className="backlog-cover-placeholder" aria-hidden="true" />
        )}
        {isDev && (
          <button
            className="backlog-cover-edit"
            onClick={() => setPickerOpen(true)}
            aria-label="Change cover"
            title="Change cover"
          >
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
              <path
                d="M11.5 1.5l3 3-9 9H2.5v-3l9-9zm-1.06 1.06l1.94 1.94 1.06-1.06-1.94-1.94-1.06 1.06z"
                fill="currentColor"
              />
            </svg>
          </button>
        )}
      </div>
      <div className="backlog-meta">
        <div className="backlog-title">
          <span>{game.title}</span>
          {game.subtitle && (
            <span className="backlog-subtitle">{game.subtitle}</span>
          )}
        </div>
        <div className="backlog-platforms">
          {game.platforms.map((p) => (
            <PlatformBadge key={p} platform={p} />
          ))}
        </div>
      </div>
      {isDev && (
        <div className="backlog-actions">
          <DevEditControls game={game} />
          <button
            className="backlog-beat-btn"
            onClick={handleMarkBeaten}
            title="Mark as beaten"
          >
            Mark Beaten
          </button>
        </div>
      )}
      {pickerOpen && (
        <CoverPicker
          title={game.title}
          sgdbId={game.sgdbId}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </li>
  );
}
