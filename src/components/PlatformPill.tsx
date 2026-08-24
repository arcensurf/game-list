import type { ShardPlatform } from '../hooks/useAchievementList';
import { ACHIEVEMENT_PLATFORM_COLORS } from '../utils/platformColors';
import { PLATFORM_LABELS } from '../utils/leaderboardFormat';

export default function PlatformPill({ platform }: { platform: ShardPlatform }) {
  return (
    <span
      className="leaderboard-platform"
      style={{ background: ACHIEVEMENT_PLATFORM_COLORS[platform] }}
    >
      {PLATFORM_LABELS[platform]}
    </span>
  );
}
