import { useEffect, useMemo, useRef, useState } from 'react';
import { PLATFORMS, useTrophyPicker } from '../hooks/useTrophyPicker';
import type { ShardPlatform } from '../hooks/useAchievementList';
import { useStageMode } from '../hooks/useStageMode';
import { usePickerBroadcast, usePickerFollower } from '../hooks/usePickerSync';
import { DEFAULT_SKIP_DAYS } from '../types/overrides';
import {
  ACHIEVEMENT_PLATFORM_COLORS,
  ACHIEVEMENT_PLATFORM_COLORS_LIGHT,
} from '../utils/platformColors';
import LampToggle from './LampToggle';
import { loadArtFallback, steamCoverFallback } from '../utils/pickerCover';
import BanListOverlay from './BanListOverlay';
import ManualPickerOverlay from './ManualPickerOverlay';
import MarksOverlay from './MarksOverlay';

const PLATFORM_LABELS: Record<string, string> = {
  steam: 'Steam',
  psn: 'PlayStation',
  xbox: 'Xbox',
  ra: 'RA',
};

// Per-device preferences, not real state — worth remembering across a
// reload, not worth syncing anywhere.
const MIN_RARITY_KEY = 'game-list:picker-min-rarity';
const SKIP_DAYS_KEY = 'game-list:picker-skip-days';
const PLATFORMS_KEY = 'game-list:picker-platforms';

function readStoredNumber(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    // Private windows and blocked site data both throw on access.
    return fallback;
  }
}

function readStoredPlatforms(): ShardPlatform[] {
  try {
    const raw = localStorage.getItem(PLATFORMS_KEY);
    if (!raw) return PLATFORMS;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return PLATFORMS;
    const kept = PLATFORMS.filter((p) => parsed.includes(p));
    // An empty save predates a guard against it, or came from storage
    // edited by hand — either way, nothing to roll from is worse than
    // ignoring the save.
    return kept.length > 0 ? kept : PLATFORMS;
  } catch {
    // Private windows and blocked site data both throw on access.
    return PLATFORMS;
  }
}

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
  gameTitle,
  url,
  iconUrl,
  onResolved,
}: {
  platform: ShardPlatform;
  gameId: string;
  gameTitle: string;
  url: string | null;
  iconUrl: string | null;
  // Reports each guess as it's tried, so the blurred stage backdrop
  // (a plain CSS background-image, which has no onError of its own)
  // can track the same fallback chain instead of freezing on whichever
  // URL happened to be first.
  onResolved: (url: string | null) => void;
}) {
  const [src, setSrc] = useState(url);
  // Guards the SGDB round trip to one attempt — if that image is itself
  // broken there's nowhere left to fall back to. A ref rather than
  // state: nothing renders from it, and it has to be readable by the
  // effect below without adding a render pass.
  const triedFallback = useRef(false);

  useEffect(() => {
    onResolved(src);
    // onResolved is a fresh setState wrapper each render — only the
    // resolved src itself should retrigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  // With no candidate URL there is no <img>, so onError never fires and
  // the SGDB lookup below is unreachable — for precisely the games it
  // exists to rescue. On non-Steam platforms pickerCoverUrl is just
  // `icon ?? null`, so anything without an icon starts here, and the
  // stage would otherwise sit with no art having asked nobody. The ref
  // guard is what stops the give-up path (which also ends at src null)
  // from restarting this.
  useEffect(() => {
    if (src || triedFallback.current) return;
    triedFallback.current = true;
    void loadArtFallback(platform, gameId, gameTitle).then(setSrc);
  }, [src, platform, gameId, gameTitle]);

  if (!src) return null;
  return (
    <img
      className="picker-cover"
      src={src}
      alt=""
      onError={() => {
        // Steam art has two guessed URLs to fall through — not every app
        // has a portrait capsule, and header.jpg exists at the legacy
        // flat path for most (but not all) of the rest — before landing
        // on iconUrl, the real header image resolved server-side during
        // the nightly fetch. That last one is the only reliable source
        // for games Valve has moved onto the newer hashed-path CDN
        // scheme, which has no flat-path alias at all. Only past all of
        // that does SGDB get a shot — it's a live lookup rather than
        // something baked into the nightly data, so it's the slowest
        // path and the last one tried.
        const fallback = steamCoverFallback(gameId);
        if (platform === 'steam' && src !== fallback) {
          setSrc(fallback);
        } else if (iconUrl && src !== iconUrl) {
          setSrc(iconUrl);
        } else if (!triedFallback.current) {
          triedFallback.current = true;
          void loadArtFallback(platform, gameId, gameTitle).then(setSrc);
        } else {
          setSrc(null);
        }
      }}
    />
  );
}

function RarityNote({ rarity }: { rarity: number | null }) {
  // Absent mainly means a Steam game with no public stats — not a
  // failure (Xbox old-gen titles used to be null here too, before the
  // contract v3 fix in scripts/fetch-achievements.mjs).
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
  const [skipDays, setSkipDays] = useState(() => readStoredNumber(SKIP_DAYS_KEY, DEFAULT_SKIP_DAYS));
  const [minRarity, setMinRarity] = useState(() => readStoredNumber(MIN_RARITY_KEY, 0));
  const [enabledPlatforms, setEnabledPlatforms] = useState<ShardPlatform[]>(readStoredPlatforms);
  const { stageOnly, toggleStage } = useStageMode();
  const [banListOpen, setBanListOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [marksOpen, setMarksOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(SKIP_DAYS_KEY, String(skipDays));
    } catch {
      // Not worth interrupting anyone over.
    }
  }, [skipDays]);

  useEffect(() => {
    try {
      localStorage.setItem(MIN_RARITY_KEY, String(minRarity));
    } catch {
      // Not worth interrupting anyone over.
    }
  }, [minRarity]);

  useEffect(() => {
    try {
      localStorage.setItem(PLATFORMS_KEY, JSON.stringify(enabledPlatforms));
    } catch {
      // Not worth interrupting anyone over.
    }
  }, [enabledPlatforms]);

  const togglePlatform = (platform: ShardPlatform) => {
    setEnabledPlatforms((prev) => {
      const on = prev.includes(platform);
      // At least one platform must stay on, or there's nothing left to
      // roll from — silently ignoring the click beats a dead picker.
      if (on && prev.length === 1) return prev;
      return on ? prev.filter((p) => p !== platform) : [...prev, platform];
    });
  };

  const {
    roll, marks, loading, rolling, error, poolSize, eligibleCount, rollTrophy, markCurrent, selectManually,
    rerollSameGame, allGames, banned, toggleBan, banCurrentGame, undo, canUndo,
    refreshGameEligibility,
  } = useTrophyPicker(minRarity, enabledPlatforms);

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

  // Marking no longer moves the roll off screen, so this is the only
  // signal that a click landed — read from the same `marks` state
  // markCurrent just wrote, keyed to the achievement actually on
  // screen so a fresh roll doesn't carry a stale badge over.
  const currentMarkStatus = roll ? marks?.overrides[roll.achievement.id]?.status : undefined;

  // Starts as the roll's own guess and gets refined by Cover as it
  // works through the fallback chain — kept separate from `shown` so
  // the backdrop doesn't need its own copy of that resolution logic.
  // Reset during render (not an effect) when the roll's own guess
  // changes, rather than one render behind it.
  const coverResetKey = shown ? `${shown.platform}|${shown.gameId}|${shown.coverUrl ?? ''}` : null;
  const [resolvedCoverUrl, setResolvedCoverUrl] = useState<string | null>(null);
  const [resolvedForKey, setResolvedForKey] = useState<string | null>(null);
  if (coverResetKey !== resolvedForKey) {
    setResolvedForKey(coverResetKey);
    setResolvedCoverUrl(shown?.coverUrl ?? null);
  }

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
            '--stage-cover': resolvedCoverUrl ? `url("${resolvedCoverUrl}")` : 'none',
            '--stage-accent': shown
              ? (ACHIEVEMENT_PLATFORM_COLORS[shown.platform] ?? '#6b7280')
              : 'transparent',
          } as React.CSSProperties
        }
      >
        <span className="picker-stage-label">Target</span>

        {/* Stage mode is on-air (OBS) and takes its roll from the
            broadcast, not from this hook — so the hook's own loading and
            error states say nothing about what the stage is showing. Left
            in, a data hiccup on the control side pasted an error string
            over a perfectly good roll and left it there, since nothing
            clears it while the follower keeps delivering rolls fine. */}
        {stageOnly && !shown ? (
          <p className="picker-status">Waiting for a roll...</p>
        ) : !stageOnly && loading ? (
          <p className="picker-status">Loading achievement data...</p>
        ) : !stageOnly && error ? (
          <p className="picker-status picker-status--error">{error}</p>
        ) : !shown ? (
          <p className="picker-status">Rolling...</p>
        ) : (
          <>
            <Cover
              key={`${shown.platform}/${shown.gameId}`}
              platform={shown.platform}
              gameId={shown.gameId}
              gameTitle={shown.gameTitle}
              url={shown.coverUrl}
              iconUrl={shown.iconUrl}
              onResolved={setResolvedCoverUrl}
            />
            <div className="picker-body">
            <div className="picker-game">
              <PlatformTag platform={shown.platform} />
              <span className="picker-game-title">{shown.gameTitle}</span>
            </div>

            <h2 className="picker-trophy">
              <span className="picker-trophy-name">{trophy!.name}</span>
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
              {trophy!.points != null && (
                <span className="picker-points">
                  {trophy!.points}
                  {shown.platform === 'xbox' ? 'G' : shown.platform === 'ra' ? ' points' : ''}
                </span>
              )}
            </div>
            </div>
          </>
        )}
      </div>

      <div className="picker-controls">
        <div className="picker-buttons">
          <button
            className="dev-btn dev-btn--primary"
            onClick={() => void rollTrophy()}
            disabled={rolling || loading}
          >
            {rolling ? 'Rolling...' : 'Roll again (R)'}
          </button>
          <button
            className="dev-btn"
            onClick={() => void rerollSameGame()}
            disabled={!roll || rolling}
            title="Roll another achievement from this same game"
          >
            Same game
          </button>
          <button
            className="dev-btn"
            onClick={() => void undo()}
            disabled={!canUndo || rolling}
            title="Back to the previous roll, undoing any mark that moved it"
          >
            Undo
          </button>

          <span className="picker-divider" aria-hidden="true" />

          <button
            className={`dev-btn${currentMarkStatus === 'earned' ? ' dev-btn--marked' : ''}`}
            onClick={() => void markCurrent('earned')}
            disabled={!roll || rolling}
            title="Already earned — the nightly run hasn't caught up yet"
          >
            {currentMarkStatus === 'earned' ? '✓ Earned' : 'Earned it'}
          </button>
          <span className="picker-skip-group">
            <button
              className={`dev-btn${currentMarkStatus === 'skipped' ? ' dev-btn--marked' : ''}`}
              onClick={() => void markCurrent('skipped', skipDays)}
              disabled={!roll || rolling}
              title={`Hide this one for ${skipDays} days`}
            >
              {currentMarkStatus === 'skipped' ? '✓ Skipped' : 'Skip'}
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
          </span>

          <span className="picker-divider" aria-hidden="true" />

          <button
            className={`dev-btn dev-btn--danger${currentMarkStatus === 'unachievable' ? ' dev-btn--marked' : ''}`}
            onClick={() => void markCurrent('unachievable')}
            disabled={!roll || rolling}
            title="Dead servers, delisted DLC — never offer this again"
          >
            {currentMarkStatus === 'unachievable' ? '✓ Marked' : "Can't be earned"}
          </button>
          <button
            className="dev-btn dev-btn--danger"
            onClick={() => void banCurrentGame()}
            disabled={!roll || rolling}
            title="Drop this whole game from the pool"
          >
            Ban game
          </button>
        </div>

        <div className="picker-filters">
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

          <span className="picker-divider" aria-hidden="true" />

          <div className="picker-platform-toggles" role="group" aria-label="Platforms to roll from">
            {PLATFORMS.map((p) => {
              const on = enabledPlatforms.includes(p);
              const label = PLATFORM_LABELS[p] ?? p;
              return (
                <LampToggle
                  key={p}
                  className="picker-platform-toggle"
                  on={on}
                  // Lit with the light-map colour, not the brand one — base
                  // PSN is 1.46:1 against an unlit key, i.e. a lamp you
                  // can't tell is on. Same reasoning as the Leaderboard's.
                  color={ACHIEVEMENT_PLATFORM_COLORS_LIGHT[p]}
                  label={label}
                  title={
                    on
                      ? `Stop rolling ${label} achievements`
                      : `Include ${label} achievements again`
                  }
                  onClick={() => togglePlatform(p)}
                />
              );
            })}
          </div>

          <span className="picker-divider" aria-hidden="true" />

          <span className="picker-eligible" title="Unearned achievements this rarity floor and platform selection leave in the pool">
            {eligibleCount == null ? 'counting…' : `${eligibleCount.toLocaleString()} eligible`}
          </span>
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
                className="dev-btn dev-btn--ghost picker-note-link"
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
          <button className="dev-btn dev-btn--ghost" onClick={toggleStage}>
            {stageOnly ? 'Show controls' : 'Stage only'}
          </button>
          <button
            className="dev-btn dev-btn--ghost"
            onClick={() => setBanListOpen(true)}
          >
            Manage bans ({Object.keys(banned).length})
          </button>
          <button
            className="dev-btn dev-btn--ghost"
            onClick={() => setManualOpen(true)}
            disabled={rolling}
            title="Load a specific achievement instead of rolling for one"
          >
            Pick manually
          </button>
          <button
            className="dev-btn dev-btn--ghost"
            onClick={() => setMarksOpen(true)}
            title="Review and clear individual earned/skipped/unachievable marks"
          >
            Review marks
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

      <ManualPickerOverlay
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        games={allGames}
        minRarity={minRarity}
        onSelect={(platform, gameId, gameTitle, coverUrl, iconUrl, achievement) => {
          setManualOpen(false);
          void selectManually(platform, gameId, gameTitle, coverUrl, iconUrl, achievement);
        }}
      />

      <MarksOverlay
        open={marksOpen}
        onClose={() => setMarksOpen(false)}
        onMarkCleared={refreshGameEligibility}
      />
    </div>
  );
}
