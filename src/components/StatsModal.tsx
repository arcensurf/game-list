import { useCallback, useRef, useState } from 'react';
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
  const [closing, setClosing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setClosing(true);
    panelRef.current?.addEventListener(
      'animationend',
      () => onClose(),
      { once: true },
    );
  }, [onClose]);

  return createPortal(
    <div className={`stats-backdrop${closing ? ' closing' : ''}`} onClick={close}>
      <div
        ref={panelRef}
        className={`stats-panel${closing ? ' closing' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="stats-header">
          <div>
            <h2>Games Per Platform</h2>
            <p className="stats-total">{totalCount} games across {stats.length} platforms</p>
          </div>
          <button className="stats-close" onClick={close} aria-label="Close">
            ✕
          </button>
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
    </div>,
    document.body,
  );
}
