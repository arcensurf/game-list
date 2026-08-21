import { useState } from 'react';
import { useLeaderboard } from '../hooks/useLeaderboard';
import { pickerCoverUrl, steamCoverFallback } from '../utils/pickerCover';
import { ACHIEVEMENT_PLATFORM_COLORS } from '../utils/platformColors';
import type { ShardPlatform } from '../hooks/useAchievementList';

const PLATFORM_LABELS: Record<ShardPlatform, string> = {
  steam: 'Steam',
  psn: 'PSN',
  xbox: 'Xbox',
  ra: 'RA',
};

function PlatformPill({ platform }: { platform: ShardPlatform }) {
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

function formatDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

type Tab = 'games' | 'rarest';

export default function LeaderboardView() {
  const { data, loading } = useLeaderboard();
  const [tab, setTab] = useState<Tab>('games');

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
      </div>

      {tab === 'games' ? (
        <ol className="leaderboard-list">
          {data.games.map((g, i) => {
            const complete = g.earned === g.total;
            return (
              <li
                key={`${g.platform}/${g.id}`}
                className={`leaderboard-row${complete ? ' leaderboard-row--complete' : ''}`}
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
      ) : (
        <ol className="leaderboard-list">
          {data.rarestAchievements.map((a, i) => (
            <li key={`${a.platform}/${a.gameId}/${a.name}/${i}`} className="leaderboard-row">
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
    </div>
  );
}
