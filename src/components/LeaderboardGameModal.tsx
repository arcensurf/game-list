import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAchievementList } from '../hooks/useAchievementList';
import type { ShardPlatform } from '../hooks/useAchievementList';
import type { LeaderboardGame } from '../types/game';
import { achievementScore } from '../utils/achievementScore';
import { buildGameScoreContext, projectUnearned } from '../utils/leaderboardCompletion';
import { PlatformPill, PLATFORM_LABELS, formatDate } from './LeaderboardView';

export interface LeaderboardModalTarget {
  platform: ShardPlatform;
  id: string;
  title: string;
  // Set from the row's own dupeKey so the modal can offer the rest of
  // its cross-platform group (see `group` below) — null/absent for a
  // game with no duplicates, or when opened from a list that doesn't
  // carry dupeKey (e.g. the Rarest Unlocks tab).
  dupeKey?: string | null;
}

export default function LeaderboardGameModal({
  target,
  group,
  onClose,
}: {
  target: LeaderboardModalTarget | null;
  // Every member of target's dupe group (including target itself),
  // highest score first — lets you flip to a platform copy that got
  // collapsed out of the list by "Hide duplicates" to check progress
  // you made there before switching to whichever copy you're playing
  // now. Omitted/undefined when target has no group.
  group?: LeaderboardGame[];
  onClose: () => void;
}) {
  // Which member of the group is currently shown — resets to `target`
  // itself whenever the modal is (re)opened for a different game, same
  // reset-on-open pattern as MarksOverlay/DuplicateGroupsOverlay.
  const [active, setActive] = useState<LeaderboardModalTarget | null>(null);

  useEffect(() => {
    setActive(null);
  }, [target]);

  const shown = active ?? target;
  const { list, loading } = useAchievementList(shown?.platform ?? null, shown?.id ?? null);

  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [target, onClose]);

  if (!target || !shown) return null;

  const members = group && group.length > 1 ? group : null;

  // Rarest first, regardless of earned status — unknown rarity (no
  // public stats) sorts last since there's nothing to rank it by.
  const rows = (list?.achievements ?? [])
    .slice()
    .sort((a, b) => {
      if (a.rarity == null) return b.rarity == null ? 0 : 1;
      if (b.rarity == null) return -1;
      return a.rarity - b.rarity;
    });

  // A game's score is its earned achievements' raw values summed, then
  // multiplied by a completion fraction — so an earned achievement's
  // actual contribution right now is its raw value times that
  // fraction, not the raw value on its own, and an unearned one's
  // marginal value if picked up next isn't just its raw value either,
  // since earning it also nudges completion for everything else
  // already earned. Computed from the shard directly so it's correct
  // regardless of which tab the game was opened from.
  const ctx = list ? buildGameScoreContext(shown.platform, list.achievements) : null;
  const completionPercent = ctx != null ? Math.round(ctx.completion * 1000) / 10 : null;
  const totalScore = ctx?.totalScore ?? null;

  return createPortal(
    <div className="leaderboard-modal-overlay" onClick={onClose}>
      <div
        className="leaderboard-modal-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={shown.title}
      >
        <div className="leaderboard-modal-head">
          <PlatformPill platform={shown.platform} />
          <span className="leaderboard-modal-title">{shown.title}</span>
          {totalScore != null && (
            <span className="leaderboard-modal-score">
              {Math.round(totalScore).toLocaleString()} pts
              {ctx != null && completionPercent != null && ctx.completion < 1 && (
                <>
                  {` · ${completionPercent}% complete · `}
                  {Math.round(ctx.maxScore).toLocaleString()} at 100%
                </>
              )}
            </span>
          )}
          <button className="leaderboard-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {members && (
          <div className="leaderboard-modal-platforms" role="tablist" aria-label="Platform copies">
            {members.map((m) => {
              const isActive = shown.platform === m.platform && shown.id === m.id;
              return (
                <button
                  key={`${m.platform}/${m.id}`}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`leaderboard-modal-platform-btn${isActive ? ' leaderboard-modal-platform-btn--active' : ''}`}
                  onClick={() => setActive({ platform: m.platform, id: m.id, title: m.title })}
                >
                  {PLATFORM_LABELS[m.platform]} · {Math.round(m.score).toLocaleString()} pts
                  {m.earned === m.total ? ' ✓' : ''}
                </button>
              );
            })}
          </div>
        )}

        <div className="leaderboard-modal-list">
          {loading && <p className="leaderboard-modal-empty">Loading achievements...</p>}
          {!loading && rows.length === 0 && (
            <p className="leaderboard-modal-empty">No achievement data for this game.</p>
          )}
          {!loading &&
            rows.map((a) => {
              const raw = achievementScore(a.rarity);
              // Earned: what it's actually contributing right now (its
              // raw value discounted to the game's completion rate),
              // with a note of the raw cap it's a share of. Unearned:
              // its own value at the completion rate earning it would
              // produce, plus the completion bump that would separately
              // apply to everything else already earned — kept as its
              // own line rather than folded into one number, since that
              // bump isn't really this achievement's own contribution.
              let primary: number | null = raw;
              let note: string | null = null;
              if (raw != null && ctx != null) {
                if (a.earned) {
                  primary = raw * ctx.completion;
                  // At 100% completion this always equals the raw value —
                  // showing "/100" next to itself is just noise.
                  if (ctx.completion < 1) note = `/${Math.round(raw)}`;
                } else {
                  const projection = projectUnearned(ctx, a);
                  if (projection) {
                    primary = projection.ownValue;
                    if (projection.completionDeltaPercent >= 0.05) {
                      note = `+${projection.completionDeltaPercent.toFixed(1)}% completion`;
                    }
                  }
                }
              }
              return (
                <div
                  key={a.id}
                  className={`leaderboard-modal-row${a.earned ? ' leaderboard-modal-row--earned' : ''}`}
                >
                  <span className="leaderboard-modal-check">{a.earned ? '✓' : ''}</span>
                  <div className="leaderboard-modal-main">
                    <div className="leaderboard-modal-name">{a.name}</div>
                    {a.description && <div className="leaderboard-modal-desc">{a.description}</div>}
                    <div className="leaderboard-modal-meta">
                      {a.rarity != null ? `${a.rarity}% of players` : 'rarity unknown'}
                      {a.earned && a.earnedAt ? ` · earned ${formatDate(a.earnedAt)}` : ''}
                    </div>
                  </div>
                  <div className={`leaderboard-modal-points-col${a.earned ? ' leaderboard-modal-points-col--inline' : ''}`}>
                    <span className="leaderboard-modal-points">
                      {primary != null ? Math.round(primary) : '—'}
                    </span>
                    {note && <span className="leaderboard-modal-points-note">{note}</span>}
                  </div>
                </div>
              );
            })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
