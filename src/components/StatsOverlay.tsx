import { useEffect } from 'react';
import StatsView from './StatsView';
import type { PlatformStat } from '../hooks/useGames';

export default function StatsOverlay({
  open,
  onClose,
  stats,
}: {
  open: boolean;
  onClose: () => void;
  stats: PlatformStat[];
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="stats-overlay" onClick={onClose}>
      <div
        className="stats-overlay-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Platform stats"
      >
        <button
          className="stats-overlay-close"
          onClick={onClose}
          aria-label="Close stats"
        >
          ×
        </button>
        <StatsView stats={stats} />
      </div>
    </div>
  );
}
