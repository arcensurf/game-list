import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import Brackets from './Brackets';

// Same shell as TimelineInfoModal/ScoringInfoModal — an info panel hung
// off a section heading, just with one short section instead of several,
// since there's one fact to convey rather than a scoring system to explain.
export default function SwitchInfoModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
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

  return createPortal(
    <div className="leaderboard-modal-overlay" onClick={onClose}>
      <div
        className="leaderboard-modal-panel scoring-info-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="What Nintendon't is"
      >
        <Brackets />

        <div className="leaderboard-modal-head">
          <div className="leaderboard-modal-head-top">
            <div className="leaderboard-modal-title-stack">
              <span className="leaderboard-modal-title">What&rsquo;s This?</span>
            </div>
            <button className="leaderboard-modal-close" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
        </div>

        <div className="scoring-info-body">
          <section className="scoring-info-section">
            <p>
              Switch and Switch 2 games beaten for the first time that year. Neither
              platform has achievements, so these clears are otherwise invisible on this
              page — everything above is achievement-tracked.
            </p>
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}
