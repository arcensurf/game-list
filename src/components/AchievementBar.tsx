import type { GameAchievements } from '../types/game';

const PLATFORM_COLORS: Record<string, string> = {
  steam: '#6b7280',
  psn: '#003087',
  xbox: '#107c10',
};

export default function AchievementBar({ achievements }: { achievements: GameAchievements | null }) {
  if (!achievements) return null;

  const { best } = achievements;
  if (best.total === 0) return null;

  const pct = (best.earned / best.total) * 100;
  const isComplete = best.earned === best.total;
  const color = isComplete ? '#d4a017' : PLATFORM_COLORS[best.platform] ?? '#6b7280';

  return (
    <div className="achievement-bar">
      <div className="achievement-bar-track">
        <div
          className="achievement-bar-fill"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="achievement-bar-label">
        {best.earned}/{best.total}
      </span>
    </div>
  );
}
