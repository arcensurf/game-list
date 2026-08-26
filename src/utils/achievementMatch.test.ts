// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  buildTitleIndex,
  normalizeTitle,
  resolveGameAchievements,
} from './achievementMatch';
import type { AchievementData, Game, PlatformLibraryEntry } from '../types/game';

const game = (over: Partial<Game> = {}): Game => ({
  title: 'Test Game',
  subtitle: null,
  platforms: ['PC'],
  extras: [],
  sgdbId: null,
  coverOverride: null,
  gameOfGames: null,
  order: 0,
  ...over,
});

const entry = (
  title: string,
  earned: number,
  total: number,
  over: Partial<PlatformLibraryEntry> = {},
): PlatformLibraryEntry => ({ title, earned, total, ...over });

const data = (over: Partial<AchievementData> = {}): AchievementData => ({
  steam: {},
  psn: {},
  xbox: {},
  ra: {},
  updatedAt: '2026-08-26T00:00:00.000Z',
  ...over,
});

const resolve = (g: Game, raw: AchievementData) =>
  resolveGameAchievements(g, raw, buildTitleIndex(raw));

describe('normalizeTitle', () => {
  it('lowercases and strips punctuation and whitespace', () => {
    expect(normalizeTitle("Assassin's Creed: Origins")).toBe('assassinscreedorigins');
  });

  it('strips a leading "the" but not an interior one', () => {
    expect(normalizeTitle('The Last of Us')).toBe('lastofus');
    expect(normalizeTitle('Rise of the Tomb Raider')).toBe('riseofthetombraider');
    // Only a *leading* "the " with trailing whitespace — "Theme Park"
    // must keep its first three letters.
    expect(normalizeTitle('Theme Park')).toBe('themepark');
  });

  it('strips trademark and copyright glyphs', () => {
    expect(normalizeTitle('DOOM® Eternal™')).toBe('doometernal');
    expect(normalizeTitle('Portal©')).toBe('portal');
  });

  it('transliterates Roman-numeral glyphs to digits instead of deleting them', () => {
    // U+2172 is a single glyph, not the letters I + I. Deleting it would
    // collapse this onto plain "FINAL FANTASY".
    expect(normalizeTitle('FINAL FANTASY ⅱ')).toBe('finalfantasy2');
    expect(normalizeTitle('FINAL FANTASY ⅸ')).toBe('finalfantasy9');
    expect(normalizeTitle('FINAL FANTASY')).toBe('finalfantasy');
    expect(normalizeTitle('FINAL FANTASY ⅱ')).not.toBe(normalizeTitle('FINAL FANTASY'));
  });

  it('transliterates superscript digits', () => {
    expect(normalizeTitle('Geometry Wars Evolved²')).toBe('geometrywarsevolved2');
    expect(normalizeTitle('Geometry Wars Evolved²')).not.toBe(
      normalizeTitle('Geometry Wars Evolved'),
    );
  });

  it('matches variants of the same game onto one key', () => {
    expect(normalizeTitle('NieR:Automata')).toBe(normalizeTitle('NieR: Automata'));
    expect(normalizeTitle('Deus Ex - Human Revolution')).toBe(
      normalizeTitle('Deus Ex: Human Revolution'),
    );
  });

  it('keeps genuinely different titles apart', () => {
    expect(normalizeTitle('Final Fantasy VII')).not.toBe(normalizeTitle('Final Fantasy VII Remake'));
  });
});

describe('buildTitleIndex', () => {
  it('returns empty maps for missing data', () => {
    const index = buildTitleIndex(null);
    expect(index.steam.size).toBe(0);
    expect(index.psn.size).toBe(0);
    expect(index.xbox.size).toBe(0);
  });

  it('breaks Steam title collisions by playtime — the copy actually played wins', () => {
    const index = buildTitleIndex(
      data({
        steam: {
          '1': entry('Portal 2', 0, 51, { playtimeMinutes: 3 }),
          '2': entry('Portal 2', 40, 51, { playtimeMinutes: 900 }),
        },
      }),
    );
    expect(index.steam.get('portal2')?.earned).toBe(40);
  });

  it('breaks PSN and Xbox title collisions by completion — demos lose', () => {
    const index = buildTitleIndex(
      data({
        psn: {
          DEMO: entry('Bloodborne', 0, 40),
          REAL: entry('Bloodborne', 31, 40),
        },
        xbox: {
          TRIAL: entry('Forza Horizon 5', 1, 100),
          FULL: entry('Forza Horizon 5', 62, 100),
        },
      }),
    );
    expect(index.psn.get('bloodborne')?.earned).toBe(31);
    expect(index.xbox.get('forzahorizon5')?.earned).toBe(62);
  });
});

describe('resolveGameAchievements', () => {
  it('returns null with no achievement data at all', () => {
    expect(resolveGameAchievements(game(), null, buildTitleIndex(null))).toBeNull();
  });

  it('returns null when nothing matches', () => {
    expect(resolve(game({ title: 'Unowned Game' }), data({ steam: { '1': entry('Portal 2', 40, 51) } }))).toBeNull();
  });

  it('falls back to a normalized-title match when no override is set', () => {
    const got = resolve(
      game({ title: 'The Last of Us Part II', platforms: ['PS4'] }),
      data({ psn: { NPWR1: entry('The Last of Us Part II', 20, 25) } }),
    );
    expect(got?.best).toEqual({ earned: 20, total: 25, platform: 'psn' });
  });

  it('prefers an explicit override ID over a title match', () => {
    const got = resolve(
      game({ title: 'Resident Evil 4', platforms: ['PS5'], psnNpCommId: 'NPWR_REMAKE' }),
      data({
        psn: {
          NPWR_ORIGINAL: entry('Resident Evil 4', 40, 40),
          NPWR_REMAKE: entry('Resident Evil 4 (Remake)', 5, 40),
        },
      }),
    );
    expect(got?.best.earned).toBe(5);
  });

  it('falls back to the title match when the override ID is not in the data', () => {
    const got = resolve(
      game({ title: 'Hades', platforms: ['PC'], steamAppId: 999999 }),
      data({ steam: { '1145360': entry('Hades', 30, 49) } }),
    );
    expect(got?.best.earned).toBe(30);
  });

  it('only consults platforms the game is actually listed on', () => {
    const got = resolve(
      game({ title: 'Celeste', platforms: ['PC'] }),
      data({
        steam: { '504230': entry('Celeste', 10, 30) },
        psn: { NPWR1: entry('Celeste', 29, 30) },
      }),
    );
    expect(got?.platforms.map((p) => p.platform)).toEqual(['steam']);
  });

  it('collects every eligible platform and picks the highest completion as best', () => {
    const got = resolve(
      game({ title: 'Hollow Knight', platforms: ['PC', 'PS4', 'Xbox One'] }),
      data({
        steam: { '1': entry('Hollow Knight', 20, 63) },
        psn: { N: entry('Hollow Knight', 63, 63) },
        xbox: { X: entry('Hollow Knight', 5, 63) },
      }),
    );
    expect(got?.platforms).toHaveLength(3);
    expect(got?.best).toEqual({ earned: 63, total: 63, platform: 'psn' });
  });

  it('ignores entries with no achievements at all', () => {
    expect(
      resolve(game({ title: 'Journey', platforms: ['PC'] }), data({ steam: { '1': entry('Journey', 0, 0) } })),
    ).toBeNull();
  });

  it('resolves FFXIV by Lodestone ID only, never by title', () => {
    const raw = data({ ffxiv: { '12345': { earned: 700, total: 3000, pointsEarned: 5000, pointsTotal: 20000, categories: [] } } });
    expect(resolve(game({ title: 'FINAL FANTASY XIV' }), raw)).toBeNull();

    const got = resolve(game({ title: 'FINAL FANTASY XIV', ffxivLodestoneId: '12345' }), raw);
    expect(got?.best.platform).toBe('ffxiv');
    expect(got?.ffxiv?.pointsTotal).toBe(20000);
  });

  it('pins the main bar to FFXIV even when a PSN entry scores far higher', () => {
    // Lodestone achievements are a superset of the PSN trophy list, so
    // the (much higher-%) PSN row must not win "best" here.
    const got = resolve(
      game({ title: 'FINAL FANTASY XIV', platforms: ['PS5'], ffxivLodestoneId: '12345', psnNpCommId: 'NPWR_XIV' }),
      data({
        psn: { NPWR_XIV: entry('FINAL FANTASY XIV', 14, 15) },
        ffxiv: { '12345': { earned: 700, total: 3000, pointsEarned: 5000, pointsTotal: 20000, categories: [] } },
      }),
    );
    expect(got?.best.platform).toBe('ffxiv');
    expect(got?.platforms.map((p) => p.platform).sort()).toEqual(['ffxiv', 'psn']);
  });

  it('carries the data timestamp through', () => {
    const got = resolve(game({ title: 'Portal 2' }), data({ steam: { '1': entry('Portal 2', 40, 51) } }));
    expect(got?.updatedAt).toBe('2026-08-26T00:00:00.000Z');
  });
});
