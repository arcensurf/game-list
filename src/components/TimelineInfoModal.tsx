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
              Every bar and split counts every copy you own, so a game played on two
              platforms lands twice. Sometimes that's a real second playthrough, sometimes
              one platform just mirrored the other — and they look identical here, so the
              totals don't guess.
            </p>
          </section>

          <section className="scoring-info-section">
            <h3>Rankings Don't Repeat</h3>
            <p>
              <strong>Top Games</strong> and <strong>rarest pulls</strong> are a shortlist,
              and a shortlist shouldn't spend two slots on one game. Each appears once, at
              whichever copy went furthest.
            </p>
          </section>

          <section className="scoring-info-section">
            <h3>Bulk Imports</h3>
            <p>
              A save carried into a re-release hands back trophies you already earned —
              dozens at once, seconds apart, dated the import. Those are listed by hand and
              left out: a hundred unlocks in a minute is a timestamp, not an evening.
            </p>
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}
