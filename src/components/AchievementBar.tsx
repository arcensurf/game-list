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

  const isComplete = best.earned === best.total;
  // The bar always fills in the platform color first. For complete
  // games, CSS layers a gold overlay that fades in after the sweep
  // finishes — the "completion reveal" moment.
  const color = PLATFORM_COLORS[best.platform] ?? '#6b7280';

  // Fixed 10-segment bar — each block represents 10% of completion.
  // Keeps the visual rhythm consistent across all cards regardless
  // of how many achievements a game has. Exact counts live in the
  // label ("25/50"); the blocks carry progress at a glance.
  //
  // Rounding guards at both extremes: the "10/10 lit" state is
  // reserved for true 100% completion (so 19/20 doesn't look like
  // platinum), and any non-zero progress shows at least 1 block
  // (so 1/50 doesn't look like 0%).
  const blockCount = 10;
  const rawLit = Math.round((best.earned / best.total) * blockCount);
  const earnedBlocks = isComplete
    ? blockCount
    : best.earned === 0
      ? 0
      : Math.min(blockCount - 1, Math.max(1, rawLit));

  return (
    <div className={`achievement-bar${isComplete ? ' achievement-bar--complete' : ''}`}>
      <div
        className="achievement-blocks"
        style={{ ['--block-color' as string]: color } as React.CSSProperties}
      >
        {Array.from({ length: blockCount }, (_, i) => (
          <span
            key={i}
            className={`achievement-block${i < earnedBlocks ? ' achievement-block--earned' : ''}`}
            style={{ ['--block-index' as string]: i } as React.CSSProperties}
            aria-hidden
          />
        ))}
      </div>
      <span className="achievement-bar-label">
        {best.earned}/{best.total}
      </span>
    </div>
  );
}
