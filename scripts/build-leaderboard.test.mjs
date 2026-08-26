// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

// The script resolves its data directory once at module load, so point
// it at a scratch dir *before* importing. assignDupeKeys re-reads
// game-links.json on every call, which is what lets each test below
// stage its own override file.
const DATA_DIR = mkdtempSync(join(tmpdir(), 'leaderboard-test-'));
mkdirSync(join(DATA_DIR, 'overrides'), { recursive: true });
process.env.DATA_DIR = DATA_DIR;

const { assignDupeKeys, normalizeTitle, topPerPlatform, weightedCompletion } = await import(
  './build-leaderboard.mjs'
);

const linksPath = join(DATA_DIR, 'overrides', 'game-links.json');
const writeLinks = (links) => writeFileSync(linksPath, JSON.stringify(links));

afterAll(() => rmSync(DATA_DIR, { recursive: true, force: true }));

beforeEach(() => writeLinks({ merges: [], splits: [] }));

const g = (platform, id, title) => ({ platform, id, title });
const keysOf = (games) => Object.fromEntries(games.map((x) => [`${x.platform}/${x.id}`, x.dupeKey]));

describe('assignDupeKeys', () => {
  it('leaves a game with no counterpart ungrouped', () => {
    const games = [g('steam', '1', 'Portal 2'), g('psn', 'A', 'Bloodborne')];
    assignDupeKeys(games);
    expect(games.every((x) => x.dupeKey === null)).toBe(true);
  });

  it('groups the same title across platforms under one key', () => {
    const games = [g('steam', '1', 'Hollow Knight'), g('psn', 'A', 'Hollow Knight')];
    assignDupeKeys(games);
    expect(games[0].dupeKey).toBe(games[1].dupeKey);
    expect(games[0].dupeKey).not.toBeNull();
  });

  it('groups two IDs on the same platform (a disc release and its re-listing)', () => {
    const games = [g('steam', '1', 'Dark Souls'), g('steam', '2', 'DARK SOULS™')];
    assignDupeKeys(games);
    expect(games[0].dupeKey).toBe(games[1].dupeKey);
  });

  it('groups a three-way cluster transitively', () => {
    const games = [g('steam', '1', 'Celeste'), g('psn', 'A', 'Celeste'), g('xbox', 'X', 'Celeste')];
    assignDupeKeys(games);
    const keys = new Set(games.map((x) => x.dupeKey));
    expect(keys.size).toBe(1);
    expect([...keys][0]).not.toBeNull();
  });

  it('matches on normalized titles, not raw ones', () => {
    const games = [g('steam', '1', 'NieR:Automata'), g('psn', 'A', 'NieR: Automata™')];
    assignDupeKeys(games);
    expect(games[0].dupeKey).toBe(games[1].dupeKey);
  });

  it('never fuzzy-matches a base game onto its remake or sequel', () => {
    const games = [
      g('psn', 'A', 'Final Fantasy VII'),
      g('psn', 'B', 'Final Fantasy VII Remake'),
      g('steam', '1', 'Final Fantasy VIII'),
    ];
    assignDupeKeys(games);
    expect(games.every((x) => x.dupeKey === null)).toBe(true);
  });

  it('honours a manual split of two same-title games', () => {
    writeLinks({ merges: [], splits: [['psn/A', 'steam/1']] });
    const games = [g('steam', '1', 'Tomb Raider'), g('psn', 'A', 'Tomb Raider')];
    assignDupeKeys(games);
    expect(games.every((x) => x.dupeKey === null)).toBe(true);
  });

  it('honours a manual merge of two differently-titled games', () => {
    writeLinks({ merges: [['psn/A', 'steam/1']], splits: [] });
    const games = [g('steam', '1', 'Yakuza 0'), g('psn', 'A', 'Ryu ga Gotoku 0')];
    assignDupeKeys(games);
    expect(games[0].dupeKey).toBe(games[1].dupeKey);
    expect(games[0].dupeKey).not.toBeNull();
  });

  it('lets a merge win over a split on the same pair', () => {
    writeLinks({ merges: [['psn/A', 'steam/1']], splits: [['psn/A', 'steam/1']] });
    const games = [g('steam', '1', 'Tomb Raider'), g('psn', 'A', 'Tomb Raider')];
    assignDupeKeys(games);
    expect(games[0].dupeKey).toBe(games[1].dupeKey);
    expect(games[0].dupeKey).not.toBeNull();
  });

  it('ignores a merge naming a game that is not in the list', () => {
    writeLinks({ merges: [['psn/GONE', 'steam/1']], splits: [] });
    const games = [g('steam', '1', 'Hades')];
    assignDupeKeys(games);
    expect(games[0].dupeKey).toBeNull();
  });

  it('falls back to title matching alone when the override file is malformed', () => {
    writeFileSync(linksPath, '{ not json');
    const games = [g('steam', '1', 'Journey'), g('psn', 'A', 'Journey')];
    expect(() => assignDupeKeys(games)).not.toThrow();
    expect(games[0].dupeKey).toBe(games[1].dupeKey);
  });

  it('picks a group key that is one of the group members', () => {
    const games = [g('steam', '1', 'Inside'), g('psn', 'A', 'Inside')];
    assignDupeKeys(games);
    expect(Object.keys(keysOf(games))).toContain(games[0].dupeKey);
  });
});

describe('topPerPlatform', () => {
  const rows = (platform, n) =>
    Array.from({ length: n }, (_, i) => ({ platform, id: `${platform}${i}`, rank: i }));

  it('keeps each platform its own top N rather than a global cut', () => {
    const all = [...rows('steam', 5), ...rows('psn', 5), ...rows('xbox', 5)];
    const got = topPerPlatform(all, 2);
    expect(got).toHaveLength(6);
    expect(got.filter((r) => r.platform === 'psn')).toHaveLength(2);
  });

  it('preserves the incoming order within a platform', () => {
    const got = topPerPlatform(rows('steam', 4), 3);
    expect(got.map((r) => r.rank)).toEqual([0, 1, 2]);
  });

  it('groups the output by platform in a stable order', () => {
    const interleaved = [
      { platform: 'psn', id: 'p' },
      { platform: 'steam', id: 's' },
      { platform: 'ra', id: 'r' },
      { platform: 'xbox', id: 'x' },
    ];
    expect(topPerPlatform(interleaved, 10).map((r) => r.platform)).toEqual([
      'steam',
      'psn',
      'xbox',
      'ra',
    ]);
  });

  it('lets kept rows ride past the limit without consuming a slot', () => {
    const all = rows('steam', 5).map((r, i) => ({ ...r, pinned: i === 4 }));
    const got = topPerPlatform(all, 2, (r) => r.pinned);
    expect(got.map((r) => r.rank)).toEqual([0, 1, 4]);
  });

  it('returns everything when the limit exceeds the row count', () => {
    expect(topPerPlatform(rows('steam', 3), 100)).toHaveLength(3);
  });

  it('drops platforms it has never seen', () => {
    expect(topPerPlatform([], 10)).toEqual([]);
  });
});

describe('weightedCompletion', () => {
  const a = (over = {}) => ({ earned: false, ...over });

  it('is flat earned/total for Steam', () => {
    expect(weightedCompletion('steam', [a({ earned: true }), a(), a(), a()])).toBe(0.25);
  });

  it('is zero for a game with no achievements', () => {
    expect(weightedCompletion('steam', [])).toBe(0);
    expect(weightedCompletion('psn', [])).toBe(0);
  });

  it('weights PSN by trophy tier', () => {
    const all = [
      a({ earned: true, type: 'platinum' }),
      a({ type: 'bronze' }),
      a({ type: 'silver' }),
      a({ type: 'gold' }),
    ];
    expect(weightedCompletion('psn', all)).toBeCloseTo(300 / 435, 10);
  });

  it('treats an unknown PSN tier as bronze', () => {
    expect(weightedCompletion('psn', [a({ earned: true, type: 'mythic' }), a({ type: 'bronze' })])).toBe(0.5);
  });

  it('weights Xbox and RA by points', () => {
    expect(weightedCompletion('xbox', [a({ earned: true, points: 90 }), a({ points: 10 })])).toBeCloseTo(0.9, 10);
  });

  it('falls back to a flat count when nothing carries points', () => {
    expect(weightedCompletion('xbox', [a({ earned: true, points: 0 }), a({ points: 0 }), a()])).toBeCloseTo(1 / 3, 10);
  });

  it('never returns 1 while achievements are outstanding', () => {
    const all = [a({ earned: true, points: 50 }), a({ points: 0 }), a({ points: 0 })];
    expect(weightedCompletion('xbox', all)).toBeCloseTo(1 / 3, 10);
  });

  it('returns 1 when everything is genuinely earned', () => {
    expect(weightedCompletion('xbox', [a({ earned: true, points: 50 }), a({ earned: true, points: 0 })])).toBe(1);
    expect(weightedCompletion('steam', [a({ earned: true }), a({ earned: true })])).toBe(1);
  });
});

describe('normalizeTitle', () => {
  it('collapses punctuation, case, and trademark glyphs', () => {
    expect(normalizeTitle('The Witcher® 3: Wild Hunt™')).toBe('witcher3wildhunt');
  });
});
