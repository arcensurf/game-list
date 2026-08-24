import type { PlatformStat } from '../hooks/useGames';
import { useTimeline } from '../hooks/useTimeline';
import PlatformBadge from './PlatformBadge';
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
  const { data: timeline, loading: timelineLoading } = useTimeline();

  return (
    <div className="stats-view">
      <div className="stats-header">
        <div>
          <h2>Games Per Platform</h2>
        </div>
      </div>
      <div className="stats-platform-top">
        {top.map(({ platform, count }) => (
          <div key={platform} className="stats-platform-top-item">
            <span className="stats-platform-top-count">{count}</span>
            <PlatformBadge platform={platform} />
          </div>
        ))}
      </div>
      {rest.length > 0 && (
        <div className="stats-rest">
          {rest.map(({ platform, count }) => (
            <span key={platform} className="stats-rest-item">
              <PlatformBadge platform={platform} />
              <span className="stats-rest-count">{count}</span>
            </span>
          ))}
        </div>
      )}
      {timeline ? (
        <AchievementYears months={timeline.months} years={timeline.years} />
      ) : (
        <div className="stats-years">
          {timelineLoading && (
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
            {timelineLoading ? 'Loading achievement history…' : 'Could not load achievement history.'}
          </p>
        </div>
      )}
    </div>
  );
}
