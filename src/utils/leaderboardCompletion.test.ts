// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildGameScoreContext, projectUnearned } from './leaderboardCompletion';
import { achievementScore } from './achievementScore';
import type { AchievementEntry } from '../types/game';

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

describe('buildGameScoreContext', () => {
  it('returns null for a game with no achievements', () => {
    expect(buildGameScoreContext('steam', [])).toBeNull();
  });

  it('weights Steam completion flat, one per achievement', () => {
    const ctx = buildGameScoreContext('steam', [
      ach({ earned: true }),
      ach({ earned: true }),
      ach(),
      ach(),
    ])!;
    expect(ctx.completion).toBe(0.5);
    expect(ctx.totalWeight).toBe(4);
    expect(ctx.earnedWeight).toBe(2);
  });

  it('weights PSN completion by trophy tier XP', () => {
    // platinum 300 earned of (300 + bronze 15 + silver 30 + gold 90) = 435
    const ctx = buildGameScoreContext('psn', [
      ach({ type: 'platinum', earned: true }),
      ach({ type: 'bronze' }),
      ach({ type: 'Silver' }),
      ach({ type: 'GOLD' }),
    ])!;
    expect(ctx.totalWeight).toBe(435);
    expect(ctx.earnedWeight).toBe(300);
    expect(ctx.completion).toBeCloseTo(300 / 435, 10);
  });

  it('treats an unknown PSN trophy type as bronze', () => {
    const ctx = buildGameScoreContext('psn', [ach({ type: 'mythic' }), ach({ type: null })])!;
    expect(ctx.totalWeight).toBe(30);
  });

  it('weights Xbox and RA completion by points', () => {
    const ctx = buildGameScoreContext('xbox', [
      ach({ points: 90, earned: true }),
      ach({ points: 10 }),
    ])!;
    expect(ctx.completion).toBeCloseTo(0.9, 10);
  });

  it('falls back to a flat weight when no achievement carries points', () => {
    const ctx = buildGameScoreContext('xbox', [
      ach({ points: 0, earned: true }),
      ach({ points: null }),
    ])!;
    expect(ctx.totalWeight).toBe(2);
    expect(ctx.completion).toBe(0.5);
  });

  it('never reports 100% while achievements are outstanding', () => {
    // Every unearned achievement is worth 0 points, so the weighted
    // ratio hits exactly 1 — which would rank an unfinished game as
    // complete. It must fall back to the flat count instead.
    const ctx = buildGameScoreContext('xbox', [
      ach({ points: 50, earned: true }),
      ach({ points: 0 }),
      ach({ points: 0 }),
    ])!;
    expect(ctx.completion).toBeLessThan(1);
    expect(ctx.completion).toBeCloseTo(1 / 3, 10);
  });

  it('does report 100% when everything really is earned', () => {
    const ctx = buildGameScoreContext('xbox', [
      ach({ points: 50, earned: true }),
      ach({ points: 0, earned: true }),
    ])!;
    expect(ctx.completion).toBe(1);
  });

  it('scores earned achievements by rarity and scales the total by completion', () => {
    const ctx = buildGameScoreContext('steam', [
      ach({ rarity: 100, earned: true }), // 10
      ach({ rarity: 25, earned: true }), // 20
      ach({ rarity: 4 }), // 50, unearned
      ach({ rarity: 4 }), // 50, unearned
    ])!;
    expect(ctx.rawScoreEarned).toBeCloseTo(30, 10);
    expect(ctx.completion).toBe(0.5);
    expect(ctx.totalScore).toBeCloseTo(15, 10);
    expect(ctx.maxScore).toBeCloseTo(130, 10);
  });

  it('treats an achievement with no rarity as worth zero score', () => {
    const ctx = buildGameScoreContext('steam', [ach({ rarity: null, earned: true })])!;
    expect(ctx.rawScoreEarned).toBe(0);
    expect(ctx.maxScore).toBe(0);
  });
});

describe('projectUnearned', () => {
  it('returns null when the achievement has no rarity to score', () => {
    const ctx = buildGameScoreContext('steam', [ach({ rarity: 50 })])!;
    expect(projectUnearned(ctx, ach({ rarity: null }))).toBeNull();
  });

  it('values an achievement at the completion rate earning it would produce', () => {
    const target = ach({ rarity: 4 }); // raw 50
    const ctx = buildGameScoreContext('steam', [ach({ earned: true }), target, ach(), ach()])!;
    expect(ctx.completion).toBe(0.25);
    // Earning it takes completion 0.25 -> 0.5, so it lands worth 50 * 0.5.
    expect(projectUnearned(ctx, target)!.ownValue).toBeCloseTo(25, 10);
  });

  it('reports the completion it would add as its share of the game', () => {
    const target = ach({ type: 'gold', rarity: 10 });
    const ctx = buildGameScoreContext('psn', [
      ach({ type: 'bronze', earned: true }), // 15
      target, // 90
      ach({ type: 'bronze' }), // 15
    ])!;
    // Weight 90 of a 120-point game.
    expect(projectUnearned(ctx, target)!.completionDeltaPercent).toBeCloseTo(75, 10);
  });

  it('values a rarer achievement above a common one in the same game', () => {
    const rare = ach({ rarity: 1 });
    const common = ach({ rarity: 90 });
    const ctx = buildGameScoreContext('steam', [ach({ earned: true }), rare, common])!;
    expect(projectUnearned(ctx, rare)!.ownValue).toBeGreaterThan(
      projectUnearned(ctx, common)!.ownValue,
    );
  });

  it('never projects an own-value above the achievement raw score', () => {
    const target = ach({ rarity: 1 });
    const ctx = buildGameScoreContext('steam', [ach({ earned: true }), target])!;
    expect(projectUnearned(ctx, target)!.ownValue).toBeLessThanOrEqual(achievementScore(1)!);
  });
});
