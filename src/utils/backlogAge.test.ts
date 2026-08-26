// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { daysOnBacklog, HEAT_CEILING_DAYS } from './backlogAge';

const at = (iso: string) => new Date(`${iso}T12:00:00`);

describe('daysOnBacklog', () => {
  it('counts whole days between the stamp and today', () => {
    expect(daysOnBacklog('2026-08-01', at('2026-08-26'))).toBe(25);
  });

  it('is zero on the day the entry was added', () => {
    expect(daysOnBacklog('2026-08-26', at('2026-08-26'))).toBe(0);
  });

  it('counts calendar boundaries, not elapsed hours', () => {
    // Late evening local time on the following day is still exactly one
    // day, because both sides are pinned to UTC midnight.
    expect(daysOnBacklog('2026-08-25', new Date('2026-08-26T23:59:00'))).toBe(1);
    expect(daysOnBacklog('2026-08-25', new Date('2026-08-26T00:01:00'))).toBe(1);
  });

  it('crosses month and year boundaries', () => {
    expect(daysOnBacklog('2025-12-31', at('2026-01-01'))).toBe(1);
    expect(daysOnBacklog('2025-08-26', at('2026-08-26'))).toBe(HEAT_CEILING_DAYS);
  });

  it('clamps a future stamp to zero rather than going negative', () => {
    expect(daysOnBacklog('2026-09-10', at('2026-08-26'))).toBe(0);
  });

  it('returns null for entries predating the field', () => {
    expect(daysOnBacklog(null)).toBeNull();
    expect(daysOnBacklog(undefined)).toBeNull();
    expect(daysOnBacklog('')).toBeNull();
  });

  it('returns null for an unparseable stamp', () => {
    expect(daysOnBacklog('not-a-date')).toBeNull();
    expect(daysOnBacklog('2026-13-45')).toBeNull();
  });
});
