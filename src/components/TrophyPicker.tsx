import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTrophyPicker } from '../hooks/useTrophyPicker';
import { DEFAULT_SKIP_DAYS } from '../types/overrides';

const PLATFORM_LABELS: Record<string, string> = {
  steam: 'Steam',
  psn: 'PlayStation',
  xbox: 'Xbox',
};

function RarityNote({ rarity }: { rarity: number | null }) {
  // Xbox 360 titles come off the legacy endpoint, which predates
  // rarity entirely — so absent is normal, not an error.
  if (rarity == null) return <span className="trophy-rarity trophy-rarity--unknown">rarity unknown</span>;
  const tier = rarity < 5 ? 'ultra' : rarity < 20 ? 'rare' : 'common';
  return (
    <span className={`trophy-rarity trophy-rarity--${tier}`}>
      {rarity}% of players
    </span>
  );
}

export default function TrophyPicker() {
  const [open, setOpen] = useState(false);
  const [skipDays, setSkipDays] = useState(DEFAULT_SKIP_DAYS);
  const { roll, loading, rolling, error, poolSize, rollTrophy, markCurrent } =
    useTrophyPicker();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Roll straight away on open — an empty panel with a button in it is
  // one click of nothing.
  useEffect(() => {
    if (open && !roll && !rolling && !loading && !error) void rollTrophy();
  }, [open, roll, rolling, loading, error, rollTrophy]);

  const trophy = roll?.achievement;

  return (
    <>
      <button className="trophy-picker-trigger" onClick={() => setOpen(true)}>
        Roll a trophy
      </button>

      {open &&
        createPortal(
          <div className="trophy-overlay" onClick={() => setOpen(false)}>
            <div
              className="trophy-panel"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label="Random trophy picker"
            >
              <button
                className="trophy-close"
                onClick={() => setOpen(false)}
                aria-label="Close trophy picker"
              >
                ×
              </button>

              {loading ? (
                <p className="trophy-status">Loading achievement data...</p>
              ) : error ? (
                <p className="trophy-status trophy-status--error">{error}</p>
              ) : !roll ? (
                <p className="trophy-status">Rolling...</p>
              ) : (
                <>
                  <p className="trophy-game">
                    <span className="trophy-platform">
                      {PLATFORM_LABELS[roll.platform] ?? roll.platform}
                    </span>
                    {roll.gameTitle}
                  </p>

                  <h2 className="trophy-name">
                    {trophy!.name}
                    {trophy!.hidden && <span className="trophy-hidden">hidden</span>}
                  </h2>

                  <p className="trophy-description">
                    {trophy!.description || <em>No description — this one is a secret.</em>}
                  </p>

                  <div className="trophy-meta">
                    <RarityNote rarity={trophy!.rarity} />
                    {trophy!.type && <span className={`trophy-type trophy-type--${trophy!.type}`}>{trophy!.type}</span>}
                    {trophy!.points != null && <span className="trophy-points">{trophy!.points}G</span>}
                  </div>
                </>
              )}

              <div className="trophy-actions">
                <button
                  className="trophy-btn trophy-btn--primary"
                  onClick={() => void rollTrophy()}
                  disabled={rolling || loading}
                >
                  {rolling ? 'Rolling...' : 'Roll again'}
                </button>
                <button
                  className="trophy-btn"
                  onClick={() => void markCurrent('earned')}
                  disabled={!roll || rolling}
                  title="Already earned — the nightly run hasn't caught up yet"
                >
                  Earned it
                </button>
                <button
                  className="trophy-btn"
                  onClick={() => void markCurrent('skipped', skipDays)}
                  disabled={!roll || rolling}
                  title={`Hide this one for ${skipDays} days`}
                >
                  Skip
                </button>
                <label className="trophy-days">
                  <input
                    type="number"
                    min={1}
                    max={3650}
                    value={skipDays}
                    onChange={(e) => setSkipDays(Number(e.target.value) || DEFAULT_SKIP_DAYS)}
                  />
                  days
                </label>
                <button
                  className="trophy-btn trophy-btn--danger"
                  onClick={() => void markCurrent('unachievable')}
                  disabled={!roll || rolling}
                  title="Dead servers, delisted DLC — never offer this again"
                >
                  Can't be earned
                </button>
              </div>

              <p className="trophy-pool">{poolSize.toLocaleString()} unearned in the pool</p>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
