import type { PlatformStat } from '../hooks/useGames';
import PlatformBadge from './PlatformBadge';

export default function StatsView({
  stats,
  totalCount,
}: {
  stats: PlatformStat[];
  totalCount: number;
}) {
  const maxCount = stats[0]?.count || 1;
  return (
    <div className="stats-view">
      <div className="stats-header">
        <div>
          <h2>Games Per Platform</h2>
          <p className="stats-total">{totalCount} games across {stats.length} platforms</p>
        </div>
      </div>
      <div className="stats-list">
        {stats.map(({ platform, count }) => (
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
    </div>
  );
}
