import { useState } from 'react';
import type React from 'react';
import type { GameWithCover } from '../types/game';
import PlatformBadge from './PlatformBadge';
import SystemHeading from './SystemHeading';
import DevEditControls from './DevEditControls';
import CoverPicker from './CoverPicker';

const isDev = import.meta.env.DEV;

type SystemGroup = { platform: string; games: GameWithCover[] };

function byTitle(a: GameWithCover, b: GameWithCover): number {
  const norm = (t: string) => t.replace(/^the\s+/i, '').toLowerCase();
  return norm(a.title).localeCompare(norm(b.title));
}

// Backlog entries are single-platform in practice — it's a list of
// things to play, so it records the copy you'd actually play. A
// multi-platform entry files under the first platform listed and keeps
// its badges on the band, so the others stay visible.
function groupBySystem(games: GameWithCover[]): SystemGroup[] {
  const map = new Map<string, GameWithCover[]>();
  for (const game of games) {
    const key = game.platforms[0] ?? 'Other';
    const list = map.get(key) ?? [];
    list.push(game);
    map.set(key, list);
  }
  return Array.from(map.entries())
    .map(([platform, list]) => ({ platform, games: list.sort(byTitle) }))
    // Biggest shelf first, matching how the stats view ranks platforms.
    .sort((a, b) => b.games.length - a.games.length || a.platform.localeCompare(b.platform));
}

export default function BacklogList({ games }: { games: GameWithCover[] }) {
  if (games.length === 0) {
    return (
      <p className="backlog-empty">
        No games in the backlog.
      </p>
    );
  }

  const systems = groupBySystem(games);
  // The entrance cascade runs down the whole page rather than restarting
  // per section, so section breaks don't stutter it.
  let bandIndex = 0;

  return (
    <div className="backlog-manifest">
      {systems.map((system) => (
        <section className="backlog-system" key={system.platform}>
          <SystemHeading platform={system.platform} count={system.games.length} />
          <ul className="backlog-system-list">
            {system.games.map((game) => (
              <BacklogBand key={game.title} game={game} index={bandIndex++} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function BacklogBand({ game, index }: { game: GameWithCover; index: number }) {
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
    <li
      className="backlog-band"
      style={{ ['--band-index' as string]: index } as React.CSSProperties}
    >
      {/* The cover is a colour source here, not a subject — blurred and
          masked so each band takes its tint from its own art without
          competing with the type it sits behind. */}
      {game.coverUrl && (
        <img
          className="backlog-band-art"
          src={game.coverUrl}
          alt=""
          loading="lazy"
          aria-hidden="true"
        />
      )}
      <div className="backlog-band-name">
        <span className="backlog-band-title">{game.title}</span>
        {game.subtitle && (
          <span className="backlog-band-subtitle">{game.subtitle}</span>
        )}
      </div>
      {/* The section heading already names the system, so a band only
          spells its platforms out when it spans more than one. */}
      {game.platforms.length > 1 && (
        <div className="backlog-band-platforms">
          {game.platforms.map((p) => (
            <PlatformBadge key={p} platform={p} />
          ))}
        </div>
      )}
      {isDev && (
        <div className="backlog-band-actions">
          <button
            className="backlog-cover-btn"
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
