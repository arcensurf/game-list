import type { PlatformStat } from '../hooks/useGames';
import PlatformBadge from './PlatformBadge';

const TOP_COUNT = 10;

export default function StatsView({
  stats,
}: {
  stats: PlatformStat[];
}) {
  const top = stats.slice(0, TOP_COUNT);
  const rest = stats.slice(TOP_COUNT);
  const maxCount = top[0]?.count || 1;

  return (
    <div className="stats-view">
      <div className="stats-header">
        <div>
          <h2>Games Per Platform</h2>
        </div>
      </div>
      <div className="stats-list">
        {top.map(({ platform, count }) => (
          <div key={platform} className="stats-row">
            <div className="stats-row-label">
              <PlatformBadge platform={platform} />
            </div>
            <span className="stats-row-count">{count}</span>
            <div className="stats-bar-track">
              <div
                className="stats-bar-fill"
                style={{ width: `${(count / maxCount) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
      {rest.length > 0 && (
        <div className="stats-rest">
          {rest.map(({ platform, count }) => (
            <span key={platform} className="stats-rest-item">
              <PlatformBadge platform={platform} />
              <span className="stats-rest-count">{count}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
