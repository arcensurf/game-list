import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import Brackets from './Brackets';

export default function ScoringInfoModal({
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
        aria-label="How scoring works"
      >
        <Brackets />

        <div className="leaderboard-modal-head">
          <div className="leaderboard-modal-head-top">
            <div className="leaderboard-modal-title-stack">
              <span className="leaderboard-modal-title">How Scoring Works</span>
            </div>
            <button className="leaderboard-modal-close" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
        </div>

        <div className="scoring-info-body">
          <section className="scoring-info-section">
            <h3>Rarity Points</h3>
            <p>
              Every achievement earns <code>10 × √(100 / rarity%)</code> points, capped at
              100 — the value of a 1%-rarity pull. Something 50% of players have earns
              little; something 0.2% of players have earns a lot.
            </p>
          </section>

          <section className="scoring-info-section">
            <h3>Completion</h3>
            <p>
              A game's earned Rarity Points are then multiplied by how much of the game is
              actually finished, so a full clear outranks a partial one with a scarier top
              end. How completion is weighted depends on what the platform publishes:
            </p>
            <ul className="scoring-info-list">
              <li><strong>Steam</strong> — flat earned/total (Steam doesn't publish per-achievement values).</li>
              <li><strong>Xbox &amp; RetroAchievements</strong> — weighted by each achievement's own gamerscore/point value.</li>
              <li><strong>PSN</strong> — weighted by trophy tier (bronze/silver/gold/platinum).</li>
            </ul>
          </section>

          <section className="scoring-info-section">
            <h3>Score</h3>
            <p>
              <strong>Score = Rarity Points earned × Completion %.</strong> The Stats tab's
              &ldquo;Rarity Points&rdquo; view shows the first half on its own, unweighted by
              completion — useful for seeing what you actually pulled in a given year,
              independent of how far along any one game was at the time.
            </p>
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}
