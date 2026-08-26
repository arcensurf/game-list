// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { achievementScore } from './achievementScore';

describe('achievementScore', () => {
  it('scores 10 points at 100% rarity', () => {
    expect(achievementScore(100)).toBe(10);
  });

  it('scales as 10 x sqrt(100 / rarity)', () => {
    expect(achievementScore(25)).toBeCloseTo(20, 10);
    expect(achievementScore(4)).toBeCloseTo(50, 10);
  });

  it('caps at 100 so sub-1% achievements cannot dominate a game', () => {
    expect(achievementScore(1)).toBe(100);
    expect(achievementScore(0.1)).toBe(100);
    expect(achievementScore(0.001)).toBe(100);
  });

  it('is monotonically decreasing in rarity', () => {
    const rarities = [1, 2, 5, 10, 25, 50, 100];
    const scores = rarities.map((r) => achievementScore(r)!);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThan(scores[i - 1]);
    }
  });

  it('returns null for missing or non-positive rarity', () => {
    expect(achievementScore(null)).toBeNull();
    expect(achievementScore(undefined)).toBeNull();
    expect(achievementScore(0)).toBeNull();
    expect(achievementScore(-5)).toBeNull();
    // Steam games with no public stats surface rarity as a non-number.
    expect(achievementScore('12' as unknown as number)).toBeNull();
  });
});
