import { useEffect, useMemo, useRef, useState } from 'react';
import type { PlatformStat } from '../hooks/useGames';
import { useTimeline } from '../hooks/useTimeline';
import { getPlatformFamily, PLATFORM_FAMILIES } from '../utils/platformColors';
import PlatformBadge from './PlatformBadge';
import Brackets from './Brackets';
import AchievementYears from './AchievementYears';

const TOP_COUNT = 5;

// Rough silhouette of a year-bars chart (see AchievementYears) — varied
// heights so it reads as a chart shape, not a row of identical ticks.
const SKELETON_BAR_HEIGHTS = [40, 65, 30, 80, 55, 45, 90, 35, 60, 50, 75, 42, 68, 38, 58, 48, 82, 33, 62, 47];

export default function StatsView({
  stats,
}: {
  stats: PlatformStat[];
}) {
  const top = stats.slice(0, TOP_COUNT);
  const rest = stats.slice(TOP_COUNT);
  const restFamilies = useMemo(() => {
    const byFamily = new Map<string, PlatformStat[]>();
    for (const stat of rest) {
      const family = getPlatformFamily(stat.platform);
      if (!byFamily.has(family)) byFamily.set(family, []);
      byFamily.get(family)!.push(stat);
    }
    return PLATFORM_FAMILIES.flatMap((family) => {
      const platforms = byFamily.get(family);
      if (!platforms) return [];
      const count = platforms.reduce((sum, s) => sum + s.count, 0);
      return [{ family, count, platforms }];
    });
  }, [rest]);
  const [openFamily, setOpenFamily] = useState<string | null>(null);
  const openFamilyStat = restFamilies.find((f) => f.family === openFamily) ?? null;
  const restRef = useRef<HTMLDivElement>(null);

  // The family row's own buttons stay visible and clickable the whole
  // time — only the panel below toggles — so beyond the panel's own
  // close control, a click on anything else outside it (including a
  // different family button, via bubbling before this fires) should
  // dismiss it too.
  useEffect(() => {
    if (openFamily == null) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!restRef.current?.contains(e.target as Node)) setOpenFamily(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenFamily(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [openFamily]);
  const { data: timeline, loading: timelineLoading } = useTimeline();
  // Dev-only: lets the loading skeleton and its entrance animation be
  // re-triggered on demand while iterating on them, instead of needing
  // a full reload every time.
  const [previewLoading, setPreviewLoading] = useState(false);
  const showLoading = timelineLoading || previewLoading;

  return (
    <div className="stats-view">
      <div className="stats-header">
        <div>
          <h2>Beaten Games Per Platform</h2>
        </div>
        {import.meta.env.DEV && (
          <button
            type="button"
            className="dev-btn"
            onClick={() => {
              setPreviewLoading(true);
              setTimeout(() => setPreviewLoading(false), 2000);
            }}
            disabled={previewLoading}
          >
            Preview loading
          </button>
        )}
      </div>
      <div className="stats-platform-top">
        <Brackets />
        {top.map(({ platform, count }) => (
          <div key={platform} className="stats-platform-top-item">
            <span className="stats-platform-top-count">{count}</span>
            <PlatformBadge platform={platform} />
          </div>
        ))}
      </div>
      {restFamilies.length > 0 && (
        <div className="stats-rest" ref={restRef}>
          <span className="stats-rest-label">More Platforms</span>
          <div className="stats-rest-families">
            {restFamilies.map(({ family, count }) => (
              <button
                key={family}
                type="button"
                className={`stats-rest-family${family === openFamily ? ' stats-rest-family--active' : ''}`}
                aria-expanded={family === openFamily}
                onClick={() => setOpenFamily((f) => (f === family ? null : family))}
              >
                <span className="stats-rest-family-count">{count}</span>
                <span className="stats-rest-family-name">{family}</span>
              </button>
            ))}
            {/* Covers the family row it was opened from — like the card
                flip revealing its back face over the card, not beside
                it — rather than opening as new content further down the
                page. Anchored to this row specifically (not .stats-rest,
                which also holds the "More Platforms" label above) so it
                starts exactly where the row itself starts. Still out of
                flow: a family can hold well over a dozen consoles
                (Nintendo), so its height is free to grow past the row's
                own and spill over the chart beneath without shifting it —
                it just covers the row first, the way clicking it should. */}
            {openFamilyStat && (
              <div className="stats-rest-popover" role="dialog" aria-label={`${openFamilyStat.family} platforms`}>
                <Brackets />
                {openFamilyStat.platforms.map(({ platform, count }) => (
                  <span key={platform} className="stats-rest-item">
                    <PlatformBadge platform={platform} />
                    <span className="stats-rest-count">{count}</span>
                  </span>
                ))}
                <button
                  type="button"
                  className="stats-rest-popover-close"
                  onClick={() => setOpenFamily(null)}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      {timeline && !previewLoading ? (
        <AchievementYears months={timeline.months} years={timeline.years} />
      ) : (
        <div className="stats-years trace-t">
          {showLoading && (
            <div className="stats-years-skeleton" aria-hidden="true">
              {SKELETON_BAR_HEIGHTS.map((h, i) => (
                <span
                  key={i}
                  className="stats-years-skeleton-bar"
                  style={{ height: `${h}%`, animationDelay: `${i * 60}ms` }}
                />
              ))}
            </div>
          )}
          <p className="stats-years-loading">
            {showLoading ? 'Loading achievement history…' : 'Could not load achievement history.'}
          </p>
        </div>
      )}
    </div>
  );
}
