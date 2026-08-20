import type { AchievementOverride, GameOverrides } from '../types/overrides';
import type { AchievementEntry } from '../types/game';

/**
 * Is this mark still suppressing the achievement?
 *
 * `skipped` is the only status that expires — an expired skip is dead
 * weight, not a block, which is what keeps the override files from
 * growing without bound as you roll.
 */
export function isActive(override: AchievementOverride | undefined, now = Date.now()): boolean {
  if (!override) return false;
  if (override.status !== 'skipped') return true;
  if (!override.until) return true;
  return Date.parse(override.until) > now;
}

/** Drop expired skips. Called before every write so files self-trim. */
export function pruneExpired(
  overrides: Record<string, AchievementOverride>,
  now = Date.now(),
): Record<string, AchievementOverride> {
  const out: Record<string, AchievementOverride> = {};
  for (const [id, override] of Object.entries(overrides)) {
    if (isActive(override, now)) out[id] = override;
  }
  return out;
}

/**
 * Achievements the picker is allowed to hand you: not already earned
 * upstream, and not suppressed by an active mark.
 */
export function eligibleAchievements(
  achievements: AchievementEntry[],
  marks: GameOverrides | null,
  now = Date.now(),
): AchievementEntry[] {
  const overrides = marks?.overrides ?? {};
  return achievements.filter(
    (a) => !a.earned && !isActive(overrides[a.id], now),
  );
}
