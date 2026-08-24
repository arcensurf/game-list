import type { PlatformStat } from '../hooks/useGames';
import { useTimeline } from '../hooks/useTimeline';
import PlatformBadge from './PlatformBadge';
import AchievementYears from './AchievementYears';

const TOP_COUNT = 5;

export default function StatsView({
  stats,
}: {
  stats: PlatformStat[];
}) {
  const top = stats.slice(0, TOP_COUNT);
  const rest = stats.slice(TOP_COUNT);
  const { data: timeline } = useTimeline();

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
      {timeline && <AchievementYears months={timeline.months} years={timeline.years} />}
    </div>
  );
}
