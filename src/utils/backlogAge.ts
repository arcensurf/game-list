/** A backlog figure this old is as hot as the ramp goes. */
export const HEAT_CEILING_DAYS = 365;

const MS_PER_DAY = 86_400_000;

/**
 * Whole days between the stamped date and today, on the local calendar
 * — both sides are pinned to UTC midnight so the difference counts day
 * boundaries rather than elapsed hours. Null when the stamp is absent
 * or unparseable, which is how entries predating the field read.
 */
export function daysOnBacklog(
  addedAt: string | null | undefined,
  now: Date = new Date()
): number | null {
  if (!addedAt) return null;
  const added = Date.parse(`${addedAt}T00:00:00Z`);
  if (Number.isNaN(added)) return null;
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((today - added) / MS_PER_DAY));
}
