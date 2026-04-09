import { createPortal } from 'react-dom';
import type { PlatformStat } from '../hooks/useGames';
import PlatformBadge from './PlatformBadge';

export default function StatsModal({
  stats,
  totalCount,
  onClose,
}: {
  stats: PlatformStat[];
  totalCount: number;
  onClose: () => void;
}) {
  const maxCount = stats[0]?.count || 1;

  return createPortal(
    <div className="stats-backdrop" onClick={onClose}>
      <div className="stats-modal" onClick={(e) => e.stopPropagation()}>
        <div className="stats-header">
          <h2>Games Per Platform</h2>
          <button className="cover-picker-close" onClick={onClose}>
            X
          </button>
        </div>
        <p className="stats-total">{totalCount} games across {stats.length} platforms</p>
        <div className="stats-list">
          {stats.map(({ platform, count }) => (
            <div key={platform} className="stats-row">
              <div className="stats-row-label">
                <PlatformBadge platform={platform} />
                <span className="stats-row-count">{count}</span>
              </div>
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
    </div>,
    document.body,
  );
}
