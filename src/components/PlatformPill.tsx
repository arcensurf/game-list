import type { ShardPlatform } from '../hooks/useAchievementList';
import { ACHIEVEMENT_PLATFORM_COLORS_LIGHT } from '../utils/platformColors';
import { PLATFORM_LABELS } from '../utils/leaderboardFormat';

export default function PlatformPill({ platform }: { platform: ShardPlatform }) {
  return (
    // The light map, not the base one: as a fill it carried white text so
    // any darkness was fine, but as ink it has to clear contrast against
    // the row itself — base PSN (#003087) measures 1.46:1 on --bg-card,
    // which is invisible.
    // Colour as ink, not as a container. The filter keys above the list
    // carry their platform colour in the lamp and keep their text neutral;
    // a row marker is data rather than a control, so it inverts that —
    // which keeps the two readable as different kinds of thing even though
    // they name the same platforms in the same palette.
    <span
      className="leaderboard-platform"
      style={{ color: ACHIEVEMENT_PLATFORM_COLORS_LIGHT[platform] }}
    >
      {PLATFORM_LABELS[platform]}
    </span>
  );
}
