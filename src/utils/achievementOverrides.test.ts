// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { eligibleAchievements, isActive, pruneExpired } from './achievementOverrides';
import type { AchievementOverride, GameOverrides, OverrideStatus } from '../types/overrides';
import type { AchievementEntry } from '../types/game';

const NOW = Date.parse('2026-08-26T12:00:00.000Z');
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

const mark = (status: OverrideStatus, until?: string): AchievementOverride => ({
  status,
  at: iso(NOW - HOUR),
  ...(until ? { until } : {}),
});

let seq = 0;
const ach = (over: Partial<AchievementEntry> = {}): AchievementEntry => ({
  id: `a${seq++}`,
  name: 'Achievement',
  description: '',
  hidden: false,
  earned: false,
  earnedAt: null,
  rarity: 50,
  ...over,
});

describe('isActive', () => {
  it('is false when there is no mark at all', () => {
    expect(isActive(undefined, NOW)).toBe(false);
  });

  it('holds indefinitely for every status other than skipped', () => {
    // `earned` is transient but not time-boxed, and `unachievable` never
    // returns to the pool — neither expires the way a snooze does, even
    // with a stray `until` on them.
    expect(isActive(mark('earned'), NOW)).toBe(true);
    expect(isActive(mark('unachievable'), NOW)).toBe(true);
    expect(isActive(mark('unachievable', iso(NOW - HOUR)), NOW)).toBe(true);
  });

  it('holds a skip that has not expired yet', () => {
    expect(isActive(mark('skipped', iso(NOW + HOUR)), NOW)).toBe(true);
  });

  it('releases a skip once its expiry has passed', () => {
    expect(isActive(mark('skipped', iso(NOW - HOUR)), NOW)).toBe(false);
  });

  it('releases a skip exactly at its expiry, not a moment later', () => {
    const until = iso(NOW);
    expect(isActive(mark('skipped', until), NOW - 1)).toBe(true);
    expect(isActive(mark('skipped', until), NOW)).toBe(false);
  });

  it('holds a skip with no expiry set', () => {
    expect(isActive(mark('skipped'), NOW)).toBe(true);
  });
});

describe('pruneExpired', () => {
  it('keeps active marks and drops expired skips', () => {
    const overrides = {
      keep: mark('unachievable'),
      live: mark('skipped', iso(NOW + HOUR)),
      dead: mark('skipped', iso(NOW - HOUR)),
    };
    expect(Object.keys(pruneExpired(overrides, NOW)).sort()).toEqual(['keep', 'live']);
  });

  it('is a no-op on an empty set', () => {
    expect(pruneExpired({}, NOW)).toEqual({});
  });
});

describe('eligibleAchievements', () => {
  it('excludes achievements already earned upstream', () => {
    const list = [ach({ id: 'earned', earned: true }), ach({ id: 'open' })];
    expect(eligibleAchievements(list, null, { now: NOW }).map((a) => a.id)).toEqual(['open']);
  });

  it('excludes achievements under an active mark but not an expired one', () => {
    const list = [ach({ id: 'marked' }), ach({ id: 'stale' }), ach({ id: 'open' })];
    const marks: GameOverrides = {
      platform: 'steam',
      id: '1',
      title: 'Test Game',
      overrides: {
        marked: mark('skipped', iso(NOW + HOUR)),
        stale: mark('skipped', iso(NOW - HOUR)),
      },
    };
    const got = eligibleAchievements(list, marks, { now: NOW }).map((a) => a.id);
    expect(got).toEqual(['stale', 'open']);
  });

  it('filters below a rarity floor when one is given', () => {
    const list = [ach({ id: 'rare', rarity: 2 }), ach({ id: 'common', rarity: 60 })];
    expect(eligibleAchievements(list, null, { minRarity: 10, now: NOW }).map((a) => a.id)).toEqual(['common']);
  });

  it('passes unknown rarity through the floor rather than failing it', () => {
    // Steam games with no public stats have no rarity; excluding them
    // would silently shrink the picker pool.
    const list = [ach({ id: 'unknown', rarity: null })];
    expect(eligibleAchievements(list, null, { minRarity: 40, now: NOW })).toHaveLength(1);
  });

  it('applies no rarity floor by default', () => {
    const list = [ach({ rarity: 0.1 }), ach({ rarity: 99 })];
    expect(eligibleAchievements(list, null, { now: NOW })).toHaveLength(2);
  });
});
