// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { getCoverUrl } from './coverUrl';
import { DATA_BASE } from './dataBase';
import type { CoverMap, Game } from '../types/game';

const game = (over: Partial<Game> = {}): Game => ({
  title: 'Portal 2',
  subtitle: null,
  platforms: ['PC'],
  extras: [],
  sgdbId: null,
  coverOverride: null,
  gameOfGames: null,
  order: 0,
  ...over,
});

describe('getCoverUrl', () => {
  it('returns null when the game has no cover at all', () => {
    expect(getCoverUrl(game(), {})).toBeNull();
  });

  it('returns null when the cover entry has no file', () => {
    const covers = { 'Portal 2': null } as CoverMap;
    expect(getCoverUrl(game(), covers)).toBeNull();
  });

  it('resolves a cover file against the data base', () => {
    const covers: CoverMap = {
      'Portal 2': { sgdbId: 1, file: 'portal-2.webp', fetchedAt: '2026-08-01T00:00:00.000Z' },
    };
    expect(getCoverUrl(game(), covers)).toBe(
      `${DATA_BASE}covers/portal-2.webp?v=${Date.parse('2026-08-01T00:00:00.000Z').toString(36)}`,
    );
  });

  it('busts the immutable cache by pick time, so re-picked art is re-fetched', () => {
    const first: CoverMap = {
      'Portal 2': { sgdbId: 1, file: 'portal-2.webp', fetchedAt: '2026-08-01T00:00:00.000Z' },
    };
    const second: CoverMap = {
      'Portal 2': { sgdbId: 2, file: 'portal-2.webp', fetchedAt: '2026-08-20T00:00:00.000Z' },
    };
    expect(getCoverUrl(game(), first)).not.toBe(getCoverUrl(game(), second));
  });

  it('omits the version when the pick timestamp is unusable', () => {
    const covers: CoverMap = {
      'Portal 2': { sgdbId: null, file: 'portal-2.webp', fetchedAt: 'whenever' },
    };
    expect(getCoverUrl(game(), covers)).toBe(`${DATA_BASE}covers/portal-2.webp`);
  });

  it('prefers an explicit override over the covers map', () => {
    const covers: CoverMap = {
      'Portal 2': { sgdbId: 1, file: 'portal-2.webp', fetchedAt: '2026-08-01T00:00:00.000Z' },
    };
    expect(getCoverUrl(game({ coverOverride: 'covers/custom.png' }), covers)).toBe(
      `${DATA_BASE}covers/custom.png`,
    );
  });

  it('does not double the slash on a leading-slash override', () => {
    const url = getCoverUrl(game({ coverOverride: '/covers/custom.png' }), {});
    expect(url).toBe(`${DATA_BASE}covers/custom.png`);
    expect(url).not.toContain('//covers');
  });

  it('looks covers up by exact title', () => {
    const covers: CoverMap = {
      'portal 2': { sgdbId: 1, file: 'portal-2.webp', fetchedAt: '2026-08-01T00:00:00.000Z' },
    };
    expect(getCoverUrl(game({ title: 'Portal 2' }), covers)).toBeNull();
  });
});
