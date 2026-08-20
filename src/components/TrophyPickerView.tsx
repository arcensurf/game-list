import { useEffect, useState } from 'react';
import { useTrophyPicker } from '../hooks/useTrophyPicker';
import { useStageMode } from '../hooks/useStageMode';
import { usePickerBroadcast, usePickerFollower } from '../hooks/usePickerSync';
import { DEFAULT_SKIP_DAYS } from '../types/overrides';
import {
  ACHIEVEMENT_PLATFORM_COLORS,
  ACHIEVEMENT_PLATFORM_COLORS_LIGHT,
} from '../utils/platformColors';

const PLATFORM_LABELS: Record<string, string> = {
  steam: 'Steam',
  psn: 'PlayStation',
  xbox: 'Xbox',
};

function PlatformTag({ platform }: { platform: string }) {
  const solid = ACHIEVEMENT_PLATFORM_COLORS[platform] ?? '#6b7280';
  const light = ACHIEVEMENT_PLATFORM_COLORS_LIGHT[platform] ?? '#a1a8b4';
  return (
    <span
      className="picker-platform"
      // Eight-digit hex: the platform's own color at low alpha for the
      // fill, its lightened variant for text and edge.
      style={{ background: `${solid}33`, borderColor: `${solid}aa`, color: light }}
    >
      {PLATFORM_LABELS[platform] ?? platform}
    </span>
  );
}

function RarityNote({ rarity }: { rarity: number | null }) {
  // Xbox 360 titles come off the legacy endpoint, which predates
  // rarity — absent is normal here, not a failure.
  if (rarity == null) {
    return <span className="picker-rarity picker-rarity--unknown">rarity unknown</span>;
  }
  const tier = rarity < 5 ? 'ultra' : rarity < 20 ? 'rare' : 'common';
  return <span className={`picker-rarity picker-rarity--${tier}`}>{rarity}% of players</span>;
}

export default function TrophyPickerView() {
  const [skipDays, setSkipDays] = useState(DEFAULT_SKIP_DAYS);
  const { stageOnly, toggleStage } = useStageMode();
  const { roll, loading, rolling, error, poolSize, rollTrophy, markCurrent } =
    useTrophyPicker();

  // Stage mode is a display, not a second roller: it mirrors whatever
  // the control window published, so OBS and the window you're driving
  // never show different trophies.
  const followed = usePickerFollower(stageOnly);
  usePickerBroadcast(roll, !stageOnly);
  const shown = stageOnly ? (followed ?? roll) : roll;

  // Roll on arrival — an empty stage is not worth showing on a stream.
  // Only the control window rolls; the stage would fight it.
  useEffect(() => {
    if (stageOnly) return;
    if (!roll && !rolling && !loading && !error) void rollTrophy();
  }, [stageOnly, roll, rolling, loading, error, rollTrophy]);

  // R rolls, so you're not hunting for the button mid-stream.
  useEffect(() => {
    if (stageOnly) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'r' && e.key !== 'R') return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      void rollTrophy();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stageOnly, rollTrophy]);

  const trophy = shown?.achievement;

  return (
    <div className="picker-view">
      {/* The stage is the only thing OBS captures: fixed size, fixed
          position, and nothing interactive inside it, so the capture
          stays stable no matter what the controls below are doing. */}
      <div className="picker-stage">
        {stageOnly && !shown ? (
          <p className="picker-status">Waiting for a roll...</p>
        ) : loading ? (
          <p className="picker-status">Loading achievement data...</p>
        ) : error ? (
          <p className="picker-status picker-status--error">{error}</p>
        ) : !shown ? (
          <p className="picker-status">Rolling...</p>
        ) : (
          <>
            <div className="picker-game">
              <PlatformTag platform={shown.platform} />
              <span className="picker-game-title">{shown.gameTitle}</span>
            </div>

            <h2 className="picker-trophy">
              {trophy!.name}
              {trophy!.hidden && <span className="picker-hidden">hidden</span>}
            </h2>

            <p className="picker-description">
              {trophy!.description || <em>No description — this one is a secret.</em>}
            </p>

            <div className="picker-meta">
              <RarityNote rarity={trophy!.rarity} />
              {trophy!.type && (
                <span className={`picker-type picker-type--${trophy!.type}`}>{trophy!.type}</span>
              )}
              {trophy!.points != null && <span className="picker-points">{trophy!.points}G</span>}
            </div>
          </>
        )}
      </div>

      <div className="picker-controls">
        <div className="picker-buttons">
          <button
            className="picker-btn picker-btn--primary"
            onClick={() => void rollTrophy()}
            disabled={rolling || loading}
          >
            {rolling ? 'Rolling...' : 'Roll again (R)'}
          </button>
          <button
            className="picker-btn"
            onClick={() => void markCurrent('earned')}
            disabled={!roll || rolling}
            title="Already earned — the nightly run hasn't caught up yet"
          >
            Earned it
          </button>
          <button
            className="picker-btn"
            onClick={() => void markCurrent('skipped', skipDays)}
            disabled={!roll || rolling}
            title={`Hide this one for ${skipDays} days`}
          >
            Skip
          </button>
          <label className="picker-days">
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
            className="picker-btn picker-btn--danger"
            onClick={() => void markCurrent('unachievable')}
            disabled={!roll || rolling}
            title="Dead servers, delisted DLC — never offer this again"
          >
            Can't be earned
          </button>
        </div>

        <div className="picker-footer">
          <button className="picker-btn picker-btn--ghost" onClick={toggleStage}>
            {stageOnly ? 'Show controls' : 'Stage only'}
          </button>
          <span className="picker-pool">{poolSize.toLocaleString()} unearned in the pool</span>
        </div>
      </div>
    </div>
  );
}
