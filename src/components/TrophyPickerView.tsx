import { useEffect, useMemo, useState } from 'react';
import { useTrophyPicker } from '../hooks/useTrophyPicker';
import { useStageMode } from '../hooks/useStageMode';
import { usePickerBroadcast, usePickerFollower } from '../hooks/usePickerSync';
import { DEFAULT_SKIP_DAYS } from '../types/overrides';
import { ACHIEVEMENT_PLATFORM_COLORS } from '../utils/platformColors';
import { steamCoverFallback } from '../utils/pickerCover';
import BanListOverlay from './BanListOverlay';

const PLATFORM_LABELS: Record<string, string> = {
  steam: 'Steam',
  psn: 'PlayStation',
  xbox: 'Xbox',
};

function PlatformTag({ platform }: { platform: string }) {
  // Solid platform color, no border. The translucent-fill-plus-outline
  // version read as a default component rather than a decision.
  const solid = ACHIEVEMENT_PLATFORM_COLORS[platform] ?? '#6b7280';
  return (
    <span className="picker-platform" style={{ background: solid }}>
      {PLATFORM_LABELS[platform] ?? platform}
    </span>
  );
}

function Cover({
  platform,
  gameId,
  url,
}: {
  platform: string;
  gameId: string;
  url: string | null;
}) {
  const [src, setSrc] = useState(url);
  if (!src) return null;
  return (
    <img
      className="picker-cover"
      src={src}
      alt=""
      onError={() => {
        // Not every Steam app has a portrait capsule; header.jpg does
        // exist for essentially all of them. One retry, then give up
        // and render nothing rather than a broken image on stream.
        const fallback = steamCoverFallback(gameId);
        setSrc(platform === 'steam' && src !== fallback ? fallback : null);
      }}
    />
  );
}

function RarityNote({ rarity }: { rarity: number | null }) {
  // Xbox 360 titles come off the legacy endpoint, which predates
  // rarity — absent is normal here, not a failure.
  if (rarity == null) {
    return <span className="picker-rarity picker-rarity--unknown">rarity unknown</span>;
  }
  const tier = rarity < 5 ? 'ultra' : rarity < 20 ? 'rare' : 'common';
  return (
    <span className={`picker-rarity picker-rarity--${tier}`}>
      Earned by {rarity}% of players
    </span>
  );
}

export default function TrophyPickerView() {
  const [skipDays, setSkipDays] = useState(DEFAULT_SKIP_DAYS);
  const [minRarity, setMinRarity] = useState(0);
  const { stageOnly, toggleStage } = useStageMode();
  const [banListOpen, setBanListOpen] = useState(false);
  const {
    roll, loading, rolling, error, poolSize, rollTrophy, markCurrent,
    allGames, banned, toggleBan, banCurrentGame, undo, canUndo,
  } = useTrophyPicker(minRarity);

  // Steam withholds hidden achievement descriptions from its API
  // entirely, so for those there's nothing to fetch — this is a manual
  // fill-in. Keyed to the current roll and never persisted: reading the
  // key back as empty is what clears it on the next roll, which avoids
  // resetting state from an effect.
  const rollKey = roll ? `${roll.platform}/${roll.gameId}/${roll.achievement.id}` : '';
  const [draft, setDraft] = useState({ key: '', text: '' });
  const typedDescription = draft.key === rollKey ? draft.text : '';

  // Folded into the achievement itself rather than sent as a separate
  // field, so the stage renders it through the normal description path
  // and needs no knowledge of overrides at all.
  const decorated = useMemo(() => {
    if (!roll || !typedDescription.trim()) return roll;
    return {
      ...roll,
      achievement: { ...roll.achievement, description: typedDescription.trim() },
    };
  }, [roll, typedDescription]);

  // Stage mode is a display, not a second roller: it mirrors whatever
  // the control window published, so OBS and the window you're driving
  // never show different trophies.
  const followed = usePickerFollower(stageOnly);
  usePickerBroadcast(decorated, !stageOnly);
  const shown = stageOnly ? (followed ?? decorated) : decorated;

  // Roll on arrival — an empty stage is not worth showing on a stream.
  // Only the control window rolls; the stage would fight it.
  useEffect(() => {
    if (stageOnly) return;
    if (!roll && !rolling && !loading && !error) void rollTrophy();
  }, [stageOnly, roll, rolling, loading, error, rollTrophy]);

  // R rolls and Cmd/Ctrl+Z steps back, so neither needs hunting for
  // mid-stream.
  useEffect(() => {
    if (stageOnly) return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        void undo();
        return;
      }
      if (e.key !== 'r' && e.key !== 'R') return;
      void rollTrophy();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stageOnly, rollTrophy, undo]);

  const trophy = shown?.achievement;

  return (
    <div className="picker-view">
      {/* The stage is the only thing OBS captures: fixed size, fixed
          position, and nothing interactive inside it, so the capture
          stays stable no matter what the controls below are doing. */}
      <div
        className="picker-stage"
        style={
          {
            // Feed the panel its own art and the platform's color, so the
            // backdrop and edge treatment change with every roll.
            '--stage-cover': shown?.coverUrl ? `url("${shown.coverUrl}")` : 'none',
            '--stage-accent': shown
              ? (ACHIEVEMENT_PLATFORM_COLORS[shown.platform] ?? '#6b7280')
              : 'transparent',
          } as React.CSSProperties
        }
      >
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
            <Cover
              key={`${shown.platform}/${shown.gameId}`}
              platform={shown.platform}
              gameId={shown.gameId}
              url={shown.coverUrl}
            />
            <div className="picker-body">
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
            onClick={() => void undo()}
            disabled={!canUndo || rolling}
            title="Back to the previous roll, undoing any mark that moved it"
          >
            Undo
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
          <label className="picker-floor" title="Applies to the next roll">
            <span>min rarity</span>
            <input
              type="range"
              min={0}
              max={50}
              step={1}
              value={minRarity}
              onChange={(e) => setMinRarity(Number(e.target.value))}
            />
            <span className="picker-floor-value">
              {minRarity === 0 ? 'off' : `${minRarity}%`}
            </span>
          </label>
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
          <button
            className="picker-btn picker-btn--danger"
            onClick={() => void banCurrentGame()}
            disabled={!roll || rolling}
            title="Drop this whole game from the pool"
          >
            Ban game
          </button>
        </div>

        {roll && !roll.achievement.description && (
          <div className="picker-note-row">
            <input
              className="picker-note"
              type="text"
              value={typedDescription}
              placeholder="Steam hides this one — paste the description to put it on stage"
              onChange={(e) => setDraft({ key: rollKey, text: e.target.value })}
            />
            {roll.platform === 'steam' && (
              // The pool id for Steam is the appid, so the community
              // achievement list is a straight substitution — somewhere
              // to go read the text that has to be typed in above.
              <a
                className="picker-btn picker-btn--ghost picker-note-link"
                href={`https://steamcommunity.com/stats/${roll.gameId}/achievements/`}
                target="_blank"
                rel="noreferrer"
              >
                Look it up ↗
              </a>
            )}
          </div>
        )}

        <div className="picker-footer">
          <button className="picker-btn picker-btn--ghost" onClick={toggleStage}>
            {stageOnly ? 'Show controls' : 'Stage only'}
          </button>
          <button
            className="picker-btn picker-btn--ghost"
            onClick={() => setBanListOpen(true)}
          >
            Manage bans ({Object.keys(banned).length})
          </button>
          <span className="picker-pool">{poolSize.toLocaleString()} unearned in the pool</span>
        </div>
      </div>

      <BanListOverlay
        open={banListOpen}
        onClose={() => setBanListOpen(false)}
        games={allGames}
        banned={banned}
        onToggle={(platform, id, title, next) => void toggleBan(platform, id, title, next)}
      />
    </div>
  );
}
