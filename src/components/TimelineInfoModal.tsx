import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import Brackets from './Brackets';

// Deliberately shares ScoringInfoModal's shell and body classes rather
// than growing a parallel set — the two are the same object, an info
// panel hung off a section heading, and should stay indistinguishable.
export default function TimelineInfoModal({
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
        aria-label="How these numbers work"
      >
        <Brackets />

        <div className="leaderboard-modal-head">
          <div className="leaderboard-modal-head-top">
            <div className="leaderboard-modal-title-stack">
              <span className="leaderboard-modal-title">How These Numbers Work</span>
            </div>
            <button className="leaderboard-modal-close" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
        </div>

        <div className="scoring-info-body">
          <section className="scoring-info-section">
            <h3>Totals Are Unfiltered</h3>
            <p>
              The year bars, the month bars and the platform splits count every copy of
              every game. Own something twice and both copies land in the total — whether
              that's one race stamped by two stores at the same instant, or a genuine
              second run on another platform years later. Nothing in the data reliably
              tells those two apart, so the totals don't guess at it.
            </p>
          </section>

          <section className="scoring-info-section">
            <h3>Rankings Don't Repeat Themselves</h3>
            <p>
              <strong>Top Games</strong> and the year's <strong>rarest achievements</strong>{' '}
              are a different question — they're a shortlist of what stood out, and a
              shortlist shouldn't spend two of its slots saying the same thing. Each game
              appears once there, kept at whichever platform copy went furthest.
            </p>
          </section>

          <section className="scoring-info-section">
            <h3>Bulk Imports</h3>
            <p>
              A few games hand back trophies you already earned somewhere else — a save
              carried into a re-release, a store syncing a library it didn't watch you
              play. Those arrive dozens at a time, seconds apart, dated the day of the
              import rather than the day you earned them. They're listed by hand and left
              out, because a hundred unlocks in a minute is a timestamp, not an evening.
            </p>
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}
