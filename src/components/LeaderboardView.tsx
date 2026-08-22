import { useState } from 'react';
import { useLeaderboard } from '../hooks/useLeaderboard';
import { pickerCoverUrl, steamCoverFallback } from '../utils/pickerCover';
import { ACHIEVEMENT_PLATFORM_COLORS } from '../utils/platformColors';
import type { ShardPlatform } from '../hooks/useAchievementList';
import { PLATFORMS } from '../hooks/useTrophyPicker';
import LeaderboardGameModal from './LeaderboardGameModal';
import type { LeaderboardModalTarget } from './LeaderboardGameModal';

// Per-device preference, not real state — worth remembering across a
// reload, not worth syncing anywhere. Mirrors the picker's own
// platform-toggle persistence (see TrophyPickerView).
const PLATFORMS_KEY = 'game-list:leaderboard-platforms';

function readStoredPlatforms(): ShardPlatform[] {
  try {
    const raw = localStorage.getItem(PLATFORMS_KEY);
    if (!raw) return PLATFORMS;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return PLATFORMS;
    const kept = PLATFORMS.filter((p) => parsed.includes(p));
    return kept.length > 0 ? kept : PLATFORMS;
  } catch {
    // Private windows and blocked site data both throw on access.
    return PLATFORMS;
  }
}

export const PLATFORM_LABELS: Record<ShardPlatform, string> = {
  steam: 'Steam',
  psn: 'PSN',
  xbox: 'Xbox',
  ra: 'RA',
};

export function PlatformPill({ platform }: { platform: ShardPlatform }) {
  return (
    <span
      className="leaderboard-platform"
      style={{ background: ACHIEVEMENT_PLATFORM_COLORS[platform] }}
    >
      {PLATFORM_LABELS[platform]}
    </span>
  );
}

// Same fallback chain as the picker's Cover component, minus the SGDB
// live lookup — that goes through a dev-only API route with nothing
// backing it on the deployed site, and this view is public.
function Thumb({
  platform,
  gameId,
  icon,
}: {
  platform: ShardPlatform;
  gameId: string;
  icon: string | null;
}) {
  const [src, setSrc] = useState(pickerCoverUrl(platform, gameId, icon));
  if (!src) return <div className="leaderboard-thumb leaderboard-thumb--empty" />;
  return (
    <img
      className="leaderboard-thumb"
      src={src}
      alt=""
      onError={() => {
        const fallback = steamCoverFallback(gameId);
        if (platform === 'steam' && src !== fallback) setSrc(fallback);
        else if (icon && src !== icon) setSrc(icon);
        else setSrc(null);
      }}
    />
  );
}

export function formatDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

type Tab = 'games' | 'rarest';

// Matches the per-platform caps in scripts/build-leaderboard.mjs — the
// data already ships each platform's own top N, so filtering down to
// one platform still has a full list to slice from here.
const GAMES_DISPLAY_LIMIT = 100;
const RAREST_DISPLAY_LIMIT = 200;

export default function LeaderboardView() {
  const { data, loading } = useLeaderboard();
  const [tab, setTab] = useState<Tab>('games');
  const [modalTarget, setModalTarget] = useState<LeaderboardModalTarget | null>(null);
  const [enabledPlatforms, setEnabledPlatforms] = useState<ShardPlatform[]>(readStoredPlatforms);

  const togglePlatform = (platform: ShardPlatform) => {
    setEnabledPlatforms((prev) => {
      const on = prev.includes(platform);
      // At least one platform must stay on, or the list goes empty with
      // no way back short of clearing storage.
      if (on && prev.length === 1) return prev;
      const next = on ? prev.filter((p) => p !== platform) : [...prev, platform];
      try {
        localStorage.setItem(PLATFORMS_KEY, JSON.stringify(next));
      } catch {
        // Not worth interrupting anyone over.
      }
      return next;
    });
  };

  if (loading) {
    return (
      <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '4rem 0' }}>
        Loading...
      </p>
    );
  }
  if (!data) {
    return (
      <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '4rem 0' }}>
        Could not load leaderboard data.
      </p>
    );
  }

  // The shipped data is each platform's own top N, not a single
  // pre-sorted global list, so filtering down needs a re-sort — and a
  // re-slice, since e.g. two platforms selected together can offer more
  // than the display cap once merged.
  const games = data.games
    .filter((g) => enabledPlatforms.includes(g.platform))
    .sort((a, b) => b.score - a.score)
    .slice(0, GAMES_DISPLAY_LIMIT);
  const rarestAchievements = data.rarestAchievements
    .filter((a) => enabledPlatforms.includes(a.platform))
    .sort((a, b) => a.rarity - b.rarity)
    .slice(0, RAREST_DISPLAY_LIMIT);

  return (
    <div className="leaderboard-view">
      <div className="leaderboard-header">
        <h2>Leaderboard</h2>
        <div className="leaderboard-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'games'}
            className={`leaderboard-tab${tab === 'games' ? ' leaderboard-tab--active' : ''}`}
            onClick={() => setTab('games')}
          >
            Top Games
          </button>
          <button
            role="tab"
            aria-selected={tab === 'rarest'}
            className={`leaderboard-tab${tab === 'rarest' ? ' leaderboard-tab--active' : ''}`}
            onClick={() => setTab('rarest')}
          >
            Rarest Unlocks
          </button>
        </div>

        <div className="leaderboard-platform-toggles" role="group" aria-label="Platforms to show">
          {PLATFORMS.map((p) => {
            const on = enabledPlatforms.includes(p);
            return (
              <button
                key={p}
                type="button"
                className={`leaderboard-platform-toggle${on ? ' leaderboard-platform-toggle--on' : ''}`}
                style={on ? { background: ACHIEVEMENT_PLATFORM_COLORS[p] } : undefined}
                onClick={() => togglePlatform(p)}
                title={on ? `Hide ${PLATFORM_LABELS[p]}` : `Show ${PLATFORM_LABELS[p]}`}
              >
                {PLATFORM_LABELS[p]}
              </button>
            );
          })}
        </div>
      </div>

      {tab === 'games' && games.length === 0 ? (
        <p className="leaderboard-empty">No games match this platform filter.</p>
      ) : tab === 'games' ? (
        <ol className="leaderboard-list">
          {games.map((g, i) => {
            const complete = g.earned === g.total;
            return (
              <li
                key={`${g.platform}/${g.id}`}
                className={`leaderboard-row${complete ? ' leaderboard-row--complete' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => setModalTarget({ platform: g.platform, id: g.id, title: g.title })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setModalTarget({ platform: g.platform, id: g.id, title: g.title });
                  }
                }}
              >
                <span className="leaderboard-rank">{i + 1}</span>
                <Thumb platform={g.platform} gameId={g.id} icon={g.icon} />
                <div className="leaderboard-main">
                  <div className="leaderboard-title">{g.title}</div>
                  <div className="leaderboard-meta">
                    <PlatformPill platform={g.platform} />
                    <span className={`leaderboard-completion${complete ? ' leaderboard-completion--complete' : ''}`}>
                      {complete && '✓ '}
                      {g.earned}/{g.total} &middot; {g.completion}% complete
                    </span>
                  </div>
                </div>
                <span className="leaderboard-score">{Math.round(g.score).toLocaleString()}</span>
              </li>
            );
          })}
        </ol>
      ) : rarestAchievements.length === 0 ? (
        <p className="leaderboard-empty">No achievements match this platform filter.</p>
      ) : (
        <ol className="leaderboard-list">
          {rarestAchievements.map((a, i) => (
            <li
              key={`${a.platform}/${a.gameId}/${a.name}/${i}`}
              className="leaderboard-row"
              role="button"
              tabIndex={0}
              onClick={() => setModalTarget({ platform: a.platform, id: a.gameId, title: a.gameTitle })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setModalTarget({ platform: a.platform, id: a.gameId, title: a.gameTitle });
                }
              }}
            >
              <span className="leaderboard-rank">{i + 1}</span>
              <Thumb platform={a.platform} gameId={a.gameId} icon={a.icon} />
              <div className="leaderboard-main">
                <div className="leaderboard-title">{a.name}</div>
                <div className="leaderboard-meta">
                  <PlatformPill platform={a.platform} />
                  <span className="leaderboard-completion">
                    {a.gameTitle}
                    {a.earnedAt ? ` · earned ${formatDate(a.earnedAt)}` : ''}
                  </span>
                </div>
              </div>
              <span className="leaderboard-score">{a.rarity}%</span>
            </li>
          ))}
        </ol>
      )}

      <LeaderboardGameModal target={modalTarget} onClose={() => setModalTarget(null)} />
    </div>
  );
}
