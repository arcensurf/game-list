// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { bestCopies, pickRarestDiverse, rollup, roundPlatforms } from './build-timeline.mjs';

const cand = (gameId, rarity, platform = 'psn') => ({ platform, gameId, rarity });

describe('pickRarestDiverse', () => {
  it('returns rarest-first', () => {
    const got = pickRarestDiverse([cand('a', 5), cand('b', 0.1), cand('c', 2)], 3);
    expect(got.map((c) => c.rarity)).toEqual([0.1, 2, 5]);
  });

  it('respects the limit', () => {
    expect(pickRarestDiverse([cand('a', 1), cand('b', 2), cand('c', 3)], 2)).toHaveLength(2);
  });

  it('never promotes a worse rarity over a better one to gain diversity', () => {
    // One game owns the two rarest pulls outright; nothing may jump them.
    const got = pickRarestDiverse([cand('a', 0.1), cand('a', 0.2), cand('b', 5)], 3);
    expect(got.map((c) => [c.gameId, c.rarity])).toEqual([
      ['a', 0.1],
      ['a', 0.2],
      ['b', 5],
    ]);
  });

  it('spreads across games within an exact rarity tie', () => {
    // Rarity is published rounded to one decimal, so a "0.1%" cluster is
    // usually several games, not one game's DLC sweep.
    const got = pickRarestDiverse(
      [cand('a', 0.1), cand('a', 0.1), cand('a', 0.1), cand('b', 0.1), cand('c', 0.1)],
      3,
    );
    expect(got.map((c) => c.gameId)).toEqual(['a', 'b', 'c']);
  });

  it('falls back to repeats within a tie once every game is represented', () => {
    const got = pickRarestDiverse([cand('a', 0.1), cand('a', 0.1), cand('b', 0.1)], 3);
    expect(got.map((c) => c.gameId).sort()).toEqual(['a', 'a', 'b']);
  });

  it('does not carry diversity pressure across rarity tiers', () => {
    // "a" is already represented at 0.1, but it still owns the whole 1.0
    // tier and must fill it before the rarer-tier-less "b" at 5.
    const got = pickRarestDiverse([cand('a', 0.1), cand('a', 1), cand('b', 5)], 2);
    expect(got.map((c) => [c.gameId, c.rarity])).toEqual([
      ['a', 0.1],
      ['a', 1],
    ]);
  });

  it('treats the same game id on different platforms as different games', () => {
    const got = pickRarestDiverse([cand('1', 0.1, 'steam'), cand('1', 0.1, 'psn'), cand('2', 0.1, 'steam')], 2);
    expect(got.map((c) => c.platform)).toEqual(['steam', 'psn']);
  });

  it('handles an empty candidate list', () => {
    expect(pickRarestDiverse([], 5)).toEqual([]);
  });

  it('does not mutate its input', () => {
    const input = [cand('a', 5), cand('b', 1)];
    pickRarestDiverse(input, 2);
    expect(input.map((c) => c.rarity)).toEqual([5, 1]);
  });
});

describe('bestCopies', () => {
  const game = (platform, id, count, score) => ({ platform, id, count, score });

  it('keeps every game when nothing is grouped', () => {
    const games = [game('steam', '1', 5, 50), game('psn', 'A', 3, 30)];
    expect(bestCopies(games, new Map())).toHaveLength(2);
  });

  it('collapses a dupe group to the copy with the most achievements', () => {
    const dupes = new Map([
      ['steam/1', 'group'],
      ['psn/A', 'group'],
    ]);
    const got = bestCopies([game('steam', '1', 2, 900), game('psn', 'A', 9, 20)], dupes);
    expect(got).toHaveLength(1);
    expect(got[0].platform).toBe('psn');
  });

  it('breaks a tied count by score', () => {
    const dupes = new Map([
      ['steam/1', 'group'],
      ['psn/A', 'group'],
    ]);
    const got = bestCopies([game('steam', '1', 5, 10), game('psn', 'A', 5, 99)], dupes);
    expect(got[0].platform).toBe('psn');
  });

  it('keeps ungrouped games alongside a collapsed group', () => {
    const dupes = new Map([
      ['steam/1', 'group'],
      ['psn/A', 'group'],
    ]);
    const got = bestCopies([game('steam', '1', 5, 10), game('psn', 'A', 9, 20), game('xbox', 'X', 1, 1)], dupes);
    expect(got.map((x) => x.platform).sort()).toEqual(['psn', 'xbox']);
  });
});

describe('rollup', () => {
  const game = (platform, count, score) => ({ platform, count, score });

  it('sums counts and scores overall and per platform', () => {
    const got = rollup([game('steam', 3, 10.5), game('steam', 2, 4.5), game('psn', 4, 20)]);
    expect(got.count).toBe(9);
    expect(got.score).toBeCloseTo(35, 10);
    expect(got.platforms.steam).toEqual({ count: 5, score: 15 });
    expect(got.platforms.psn).toEqual({ count: 4, score: 20 });
  });

  it('is zero for an empty list', () => {
    expect(rollup([])).toEqual({ count: 0, score: 0, platforms: {} });
  });

  it('counts every copy — duplicates are not collapsed in the running totals', () => {
    expect(rollup([game('steam', 5, 10), game('psn', 5, 10)]).count).toBe(10);
  });
});

describe('roundPlatforms', () => {
  it('rounds scores to one decimal and leaves counts alone', () => {
    expect(roundPlatforms({ steam: { count: 7, score: 123.456 } })).toEqual({
      steam: { count: 7, score: 123.5 },
    });
  });

  it('drops any key beyond count and score', () => {
    expect(roundPlatforms({ psn: { count: 1, score: 1, extra: 'x' } })).toEqual({
      psn: { count: 1, score: 1 },
    });
  });
});
