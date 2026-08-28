// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

// Both directories are resolved once at module load, so they have to be
// pointed at scratch space *before* the import. TOKEN_DIR especially:
// the module mkdirs it on load, and its default is the real ~/.game-list
// where the live PSN and Xbox refresh tokens live.
const DATA_DIR = mkdtempSync(join(tmpdir(), 'fetch-ach-data-'));
const TOKEN_DIR = mkdtempSync(join(tmpdir(), 'fetch-ach-token-'));
process.env.DATA_DIR = DATA_DIR;
process.env.TOKEN_DIR = TOKEN_DIR;
delete process.env.FORCE_REFRESH;

const {
  buildRaShard,
  buildSteamShard,
  currentShard,
  idHash,
  isRefreshDay,
  listDisagreesWithLibrary,
  mapXboxLegacy,
  mapXboxModern,
  mergePsnTrophies,
  mergeXboxAchievements,
  parseRarity,
  pruneShards,
  raTimestampToIso,
  readShard,
  resolveXboxTotal,
  safeId,
  sumPsnTrophyCounts,
  writeShard,
  xboxTitleHasProgress,
  xboxUnlockedAt,
} = await import('./fetch-achievements.mjs');

const shardsDir = resolve(DATA_DIR, 'achievements');
const shardFile = (platform, id) => resolve(shardsDir, platform, `${id}.json`);

afterAll(() => {
  rmSync(DATA_DIR, { recursive: true, force: true });
  rmSync(TOKEN_DIR, { recursive: true, force: true });
});

beforeEach(() => rmSync(shardsDir, { recursive: true, force: true }));

describe('safeId', () => {
  it('leaves ordinary platform IDs untouched', () => {
    expect(safeId('620')).toBe('620');
    expect(safeId('NPWR24281_00')).toBe('NPWR24281_00');
    expect(safeId('1234567890')).toBe('1234567890');
    expect(safeId('some-title-id')).toBe('some-title-id');
  });

  it('coerces a numeric ID to a string', () => {
    expect(safeId(620)).toBe('620');
  });

  it('neutralises path traversal — these IDs come from upstream APIs', () => {
    expect(safeId('../../etc/passwd')).not.toContain('/');
    expect(safeId('../../etc/passwd')).not.toContain('..');
    expect(safeId('..')).toBe('__');
    expect(safeId('a/b')).toBe('a_b');
    expect(safeId('a\\b')).toBe('a_b');
  });

  it('strips anything that is not alphanumeric, underscore or dash', () => {
    expect(safeId('a b!c$d')).toBe('a_b_c_d');
    expect(safeId('résumé')).toBe('r_sum_');
  });

  it('is stable — the same ID always maps to the same filename', () => {
    expect(safeId('a/b')).toBe(safeId('a\\b'));
  });
});

describe('parseRarity', () => {
  it('keeps full float precision — no rounding', () => {
    // Shards are R2-only (never git-diffed) and R2's sync already skips
    // a shard whose bytes didn't change, so there's nothing left for
    // rounding to protect — and it used to floor a genuine 0.04% rarity
    // down to 0, which achievementScore treats as invalid.
    expect(parseRarity(12.34567)).toBe(12.34567);
    expect(parseRarity(0.04)).toBe(0.04);
  });

  it('parses the string percentages Steam returns', () => {
    expect(parseRarity('45.6789')).toBe(45.6789);
    expect(parseRarity('100')).toBe(100);
  });

  it('is idempotent', () => {
    for (const v of [0, 0.1, 12.34567, 45.7, 99.9, 100]) {
      expect(parseRarity(parseRarity(v))).toBe(parseRarity(v));
    }
  });

  it('returns null for anything unusable rather than NaN', () => {
    expect(parseRarity(null)).toBeNull();
    expect(parseRarity(undefined)).toBeNull();
    expect(parseRarity('')).toBeNull();
    expect(parseRarity('not a number')).toBeNull();
    expect(parseRarity(Infinity)).toBeNull();
    expect(parseRarity(NaN)).toBeNull();
  });

  it('keeps zero as zero, not null', () => {
    expect(parseRarity(0)).toBe(0);
    expect(parseRarity('0')).toBe(0);
  });
});

describe('idHash / isRefreshDay', () => {
  it('hashes deterministically to a non-negative integer', () => {
    expect(idHash('620')).toBe(idHash('620'));
    expect(idHash('620')).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(idHash('NPWR24281_00'))).toBe(true);
  });

  it('treats a number and its string form as the same ID', () => {
    expect(idHash(620)).toBe(idHash('620'));
  });

  it('separates different IDs', () => {
    expect(idHash('620')).not.toBe(idHash('621'));
  });

  it('puts every ID on exactly one day of the cycle', () => {
    const id = 'NPWR24281_00';
    const days = [0, 1, 2, 3, 4, 5, 6].filter((day) => isRefreshDay(id, day));
    expect(days).toHaveLength(1);
  });

  it('repeats on a 7-day cycle', () => {
    const id = '620';
    for (let day = 0; day < 21; day++) {
      expect(isRefreshDay(id, day)).toBe(isRefreshDay(id, day + 7));
    }
  });

  // The point of hashing the ID is that a given night re-pulls ~1/7 of
  // the library rather than landing all 670 games in one commit. Both
  // shapes below are dense and sequential, the way a real Steam or PSN
  // library is — the hash is linear in the ID's characters, so a sample
  // strided by a multiple of 7 would land in one bucket by construction
  // and prove nothing about a real library.
  it.each([
    ['steam appids', Array.from({ length: 700 }, (_, i) => String(10 + i))],
    ['psn ids', Array.from({ length: 700 }, (_, i) => `NPWR${(10000 + i).toString().padStart(5, '0')}_00`)],
  ])('spreads a realistic library of %s evenly across the week', (_label, ids) => {
    const perDay = [0, 1, 2, 3, 4, 5, 6].map(
      (day) => ids.filter((id) => isRefreshDay(id, day)).length,
    );
    expect(perDay.reduce((a, b) => a + b, 0)).toBe(ids.length);
    const ideal = ids.length / 7;
    for (const count of perDay) {
      expect(count).toBeGreaterThan(ideal * 0.75);
      expect(count).toBeLessThan(ideal * 1.25);
    }
  });
});

describe('writeShard / readShard', () => {
  const payload = { platform: 'steam', id: '620', title: 'Portal 2', earned: 1, total: 2, achievements: [] };

  it('writes a new shard and reports that it did', () => {
    expect(writeShard('steam', '620', payload)).toBe(true);
    expect(existsSync(shardFile('steam', '620'))).toBe(true);
  });

  it('skips a rewrite when the bytes would be identical', () => {
    // One played game must be a one-file diff, not 670 — the nightly
    // commit is only proportional to what changed while this holds.
    writeShard('steam', '620', payload);
    expect(writeShard('steam', '620', { ...payload })).toBe(false);
  });

  it('rewrites when the content actually changed', () => {
    writeShard('steam', '620', payload);
    expect(writeShard('steam', '620', { ...payload, earned: 2 })).toBe(true);
  });

  it('writes stable, newline-terminated JSON', () => {
    writeShard('steam', '620', payload);
    const raw = readFileSync(shardFile('steam', '620'), 'utf-8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(JSON.parse(raw)).toEqual(payload);
  });

  it('contains no timestamp — a timestamp would rewrite every shard nightly', () => {
    writeShard('steam', '620', payload);
    expect(readFileSync(shardFile('steam', '620'), 'utf-8')).not.toMatch(/updatedAt|fetchedAt/);
  });

  it('sanitises the ID into the path it writes', () => {
    writeShard('psn', '../escape', payload);
    expect(existsSync(shardFile('psn', '___escape'))).toBe(true);
    expect(existsSync(resolve(DATA_DIR, 'escape.json'))).toBe(false);
    expect(existsSync(resolve(shardsDir, 'escape.json'))).toBe(false);
  });

  it('round-trips through readShard', () => {
    writeShard('psn', 'NPWR1_00', payload);
    expect(readShard('psn', 'NPWR1_00')).toEqual(payload);
  });

  it('reads a missing shard as null', () => {
    expect(readShard('steam', 'nope')).toBeNull();
  });

  it('reads a corrupt shard as null, so it gets refetched', () => {
    mkdirSync(resolve(shardsDir, 'steam'), { recursive: true });
    writeFileSync(shardFile('steam', '620'), '{ truncated');
    expect(readShard('steam', '620')).toBeNull();
  });
});

describe('pruneShards', () => {
  const write = (platform, id) =>
    writeShard(platform, id, { platform, id, title: id, earned: 0, total: 1, achievements: [] });

  it('removes shards for games no longer in the library', () => {
    write('steam', '620');
    write('steam', '999');
    expect(pruneShards('steam', ['620'])).toBe(1);
    expect(existsSync(shardFile('steam', '620'))).toBe(true);
    expect(existsSync(shardFile('steam', '999'))).toBe(false);
  });

  it('keeps everything when the whole library is passed', () => {
    write('steam', '620');
    write('steam', '999');
    expect(pruneShards('steam', ['620', '999'])).toBe(0);
  });

  it('matches keep-IDs through the same sanitiser used to write them', () => {
    write('psn', '../escape');
    expect(pruneShards('psn', ['../escape'])).toBe(0);
    expect(existsSync(shardFile('psn', '___escape'))).toBe(true);
  });

  it('wipes the platform when the library comes back empty', () => {
    // Guarded at the call site — only ever invoked for a platform that
    // actually returned data — but the helper itself does as it is told.
    write('xbox', '111');
    expect(pruneShards('xbox', [])).toBe(1);
  });

  it('is a no-op for a platform with no shard directory yet', () => {
    expect(pruneShards('ra', ['1'])).toBe(0);
  });

  it('leaves other platforms alone', () => {
    write('steam', '620');
    write('psn', 'NPWR1_00');
    pruneShards('steam', []);
    expect(existsSync(shardFile('psn', 'NPWR1_00'))).toBe(true);
  });

  it('ignores non-JSON files in the directory', () => {
    write('steam', '620');
    writeFileSync(resolve(shardsDir, 'steam', 'README.txt'), 'notes');
    pruneShards('steam', []);
    expect(existsSync(resolve(shardsDir, 'steam', 'README.txt'))).toBe(true);
  });
});

describe('currentShard', () => {
  // isRefreshDay is pinned to the day the module loaded, so pick IDs by
  // what it actually reports rather than hardcoding one — otherwise these
  // would pass six days a week and fail on the seventh.
  const stableId = ['1', '2', '3', '4', '5', '6', '7', '8'].find((id) => !isRefreshDay(id));
  const refreshId = ['1', '2', '3', '4', '5', '6', '7', '8'].find((id) => isRefreshDay(id));

  const seed = (id, earned, total) =>
    writeShard('steam', id, {
      platform: 'steam',
      id,
      title: 'Test',
      earned,
      total,
      achievements: [{ id: 'a', earned: earned > 0 }],
    });

  it('reuses a shard whose counts still match', () => {
    seed(stableId, 1, 2);
    expect(currentShard('steam', stableId, 1, 2)).not.toBeNull();
  });

  it('rejects a shard once the earned count has moved', () => {
    seed(stableId, 1, 2);
    expect(currentShard('steam', stableId, 2, 2)).toBeNull();
  });

  it('rejects a shard once the total has moved — new DLC', () => {
    seed(stableId, 1, 2);
    expect(currentShard('steam', stableId, 1, 5)).toBeNull();
  });

  it('rejects a shard on its scheduled refresh day, so rarity stays current', () => {
    seed(refreshId, 1, 2);
    expect(currentShard('steam', refreshId, 1, 2)).toBeNull();
  });

  it('rejects a missing shard', () => {
    expect(currentShard('steam', stableId, 1, 2)).toBeNull();
  });

  it('rejects a shard with no achievements array', () => {
    writeShard('steam', stableId, { platform: 'steam', id: stableId, earned: 1, total: 2 });
    expect(currentShard('steam', stableId, 1, 2)).toBeNull();
  });
});

describe('buildSteamShard', () => {
  const entry = { platformId: 620, platformTitle: 'Portal 2' };
  const row = (over = {}) => ({
    apiname: 'ACH_1',
    name: 'First Steps',
    description: 'Take a step',
    achieved: 0,
    unlocktime: 0,
    ...over,
  });

  it('carries the library title and stringifies the appid', () => {
    const shard = buildSteamShard(entry, [], new Map());
    expect(shard).toMatchObject({ platform: 'steam', id: '620', title: 'Portal 2', earned: 0, total: 0 });
  });

  it('counts earned from the achieved flag and total from the list length', () => {
    const shard = buildSteamShard(entry, [row({ achieved: 1 }), row({ apiname: 'ACH_2' })], new Map());
    expect(shard.earned).toBe(1);
    expect(shard.total).toBe(2);
    expect(shard.achievements[0].earned).toBe(true);
    expect(shard.achievements[1].earned).toBe(false);
  });

  it('converts the unix unlock time to ISO', () => {
    const shard = buildSteamShard(entry, [row({ achieved: 1, unlocktime: 1_700_000_000 })], new Map());
    expect(shard.achievements[0].earnedAt).toBe(new Date(1_700_000_000_000).toISOString());
  });

  it('leaves earnedAt null for an unearned achievement', () => {
    expect(buildSteamShard(entry, [row()], new Map()).achievements[0].earnedAt).toBeNull();
  });

  it('leaves earnedAt null when Steam reports the unlock with no timestamp', () => {
    expect(buildSteamShard(entry, [row({ achieved: 1, unlocktime: 0 })], new Map()).achievements[0].earnedAt).toBeNull();
  });

  it('infers hidden from a blank description', () => {
    // GetPlayerAchievements has no hidden flag; a withheld description is
    // the only signal it gives. Inferred, not exact.
    const shard = buildSteamShard(entry, [row({ description: '' }), row({ apiname: 'B' })], new Map());
    expect(shard.achievements[0].hidden).toBe(true);
    expect(shard.achievements[1].hidden).toBe(false);
  });

  it('defaults a missing description to empty rather than undefined', () => {
    const shard = buildSteamShard(entry, [row({ description: undefined })], new Map());
    expect(shard.achievements[0].description).toBe('');
    expect(shard.achievements[0].hidden).toBe(true);
  });

  it('falls back to the API name when there is no display name', () => {
    expect(buildSteamShard(entry, [row({ name: '' })], new Map()).achievements[0].name).toBe('ACH_1');
  });

  it('joins rarity on the API name and nulls a miss', () => {
    const shard = buildSteamShard(entry, [row(), row({ apiname: 'ACH_2' })], new Map([['ACH_1', 12.3]]));
    expect(shard.achievements[0].rarity).toBe(12.3);
    expect(shard.achievements[1].rarity).toBeNull();
  });
});

describe('raTimestampToIso', () => {
  it('reads RA\'s space-separated UTC stamps', () => {
    expect(raTimestampToIso('2022-08-23 22:56:38')).toBe('2022-08-23T22:56:38.000Z');
  });

  it('treats the stamp as UTC, not local time', () => {
    // No offset is given, so an unqualified Date() parse would shift it
    // by the runner's timezone.
    expect(raTimestampToIso('2022-01-01 00:00:00')).toBe('2022-01-01T00:00:00.000Z');
  });

  it('returns null for a missing or unparseable stamp', () => {
    expect(raTimestampToIso(null)).toBeNull();
    expect(raTimestampToIso(undefined)).toBeNull();
    expect(raTimestampToIso('')).toBeNull();
    expect(raTimestampToIso('never')).toBeNull();
  });
});

describe('buildRaShard', () => {
  const entry = { platformId: 4321, platformTitle: 'Super Metroid', earned: 1, total: 2 };
  const row = (over = {}) => ({
    ID: 100,
    Title: 'First Missile',
    Description: 'Find a missile',
    Points: 5,
    Type: 'progression',
    NumAwarded: 50,
    DateEarnedHardcore: null,
    ...over,
  });

  it('takes its header counts from the library entry, not the row list', () => {
    const shard = buildRaShard(entry, [row(), row({ ID: 101 })], 100);
    expect(shard).toMatchObject({ platform: 'ra', id: '4321', title: 'Super Metroid', earned: 1, total: 2 });
  });

  it('counts only hardcore unlocks as earned', () => {
    // A softcore-only clear (save states, rewind) stays open here.
    const shard = buildRaShard(entry, [
      row({ DateEarnedHardcore: '2022-08-23 22:56:38' }),
      row({ ID: 101, DateEarned: '2022-08-23 22:56:38' }),
    ], 100);
    expect(shard.achievements[0].earned).toBe(true);
    expect(shard.achievements[0].earnedAt).toBe('2022-08-23T22:56:38.000Z');
    expect(shard.achievements[1].earned).toBe(false);
    expect(shard.achievements[1].earnedAt).toBeNull();
  });

  it('computes rarity as the share of players holding the achievement', () => {
    expect(buildRaShard(entry, [row({ NumAwarded: 25 })], 100).achievements[0].rarity).toBe(25);
    expect(buildRaShard(entry, [row({ NumAwarded: 1 })], 3).achievements[0].rarity).toBeCloseTo(33.333, 3);
  });

  it('nulls rarity when the player count is unknown, rather than dividing by zero', () => {
    expect(buildRaShard(entry, [row()], 0).achievements[0].rarity).toBeNull();
  });

  it('marks nothing hidden — RA never withholds a description', () => {
    expect(buildRaShard(entry, [row()], 100).achievements[0].hidden).toBe(false);
  });

  it('carries points and type through for completion weighting', () => {
    const a = buildRaShard(entry, [row({ Points: 25, Type: 'win_condition' })], 100).achievements[0];
    expect(a.points).toBe(25);
    expect(a.type).toBe('win_condition');
  });

  it('defaults missing fields rather than emitting undefined', () => {
    const a = buildRaShard(entry, [{ ID: 1, NumAwarded: 0 }], 100).achievements[0];
    expect(a).toMatchObject({ id: '1', name: '', description: '', type: null, points: null, earned: false });
  });
});

describe('sumPsnTrophyCounts', () => {
  it('sums every tier', () => {
    expect(sumPsnTrophyCounts({ bronze: 20, silver: 8, gold: 3, platinum: 1 })).toBe(32);
  });

  it('treats a missing tier as zero', () => {
    expect(sumPsnTrophyCounts({ bronze: 5 })).toBe(5);
  });

  it('is zero for a missing block', () => {
    expect(sumPsnTrophyCounts(undefined)).toBe(0);
    expect(sumPsnTrophyCounts(null)).toBe(0);
    expect(sumPsnTrophyCounts({})).toBe(0);
  });
});

describe('mergePsnTrophies', () => {
  const def = (over = {}) => ({
    trophyId: 1,
    trophyName: 'First Blood',
    trophyDetail: 'Win a fight',
    trophyType: 'bronze',
    trophyHidden: false,
    ...over,
  });

  it('joins definitions to earned rows on trophyId', () => {
    const got = mergePsnTrophies(
      [def(), def({ trophyId: 2, trophyName: 'Platinum' })],
      [{ trophyId: 2, earned: true, earnedDateTime: '2024-01-01T00:00:00Z', trophyEarnedRate: '3.4567' }],
    );
    expect(got[0]).toMatchObject({ id: '1', name: 'First Blood', earned: false, earnedAt: null, rarity: null });
    expect(got[1]).toMatchObject({ id: '2', earned: true, earnedAt: '2024-01-01T00:00:00Z', rarity: 3.4567 });
  });

  it('keeps every definition, in definition order', () => {
    const got = mergePsnTrophies([def({ trophyId: 3 }), def({ trophyId: 1 }), def({ trophyId: 2 })], []);
    expect(got.map((t) => t.id)).toEqual(['3', '1', '2']);
  });

  it('ignores an earned row with no matching definition', () => {
    expect(mergePsnTrophies([def()], [{ trophyId: 99, earned: true }])).toHaveLength(1);
  });

  it('treats an explicit earned:false row as unearned', () => {
    const got = mergePsnTrophies([def()], [{ trophyId: 1, earned: false, trophyEarnedRate: '50' }]);
    expect(got[0].earned).toBe(false);
  });

  it('carries the trophy tier through — completion weighting depends on it', () => {
    const got = mergePsnTrophies([def({ trophyType: 'platinum' })], []);
    expect(got[0].type).toBe('platinum');
  });

  it('marks a hidden trophy only on an explicit true', () => {
    expect(mergePsnTrophies([def({ trophyHidden: true })], [])[0].hidden).toBe(true);
    expect(mergePsnTrophies([def({ trophyHidden: undefined })], [])[0].hidden).toBe(false);
  });

  it('defaults missing text to empty strings rather than undefined', () => {
    const got = mergePsnTrophies([{ trophyId: 1 }], []);
    expect(got[0]).toMatchObject({ id: '1', name: '', description: '', type: null });
  });

  it('handles a title with no trophies at all', () => {
    expect(mergePsnTrophies([], [])).toEqual([]);
  });
});

describe('xboxTitleHasProgress', () => {
  it('keeps a title with a real achievement total', () => {
    expect(xboxTitleHasProgress({ achievement: { totalAchievements: 50, currentAchievements: 0 } })).toBe(true);
  });

  it('keeps a current-gen title whose total is the known-bad zero', () => {
    // titleHub reports totalAchievements: 0 for every current-gen title
    // on this account regardless of progress, so currentAchievements has
    // to be able to carry the decision alone.
    expect(xboxTitleHasProgress({ achievement: { totalAchievements: 0, currentAchievements: 19 } })).toBe(true);
  });

  it('drops apps and system tiles with no achievement block', () => {
    expect(xboxTitleHasProgress({ name: 'Netflix' })).toBe(false);
    expect(xboxTitleHasProgress({ name: 'X', achievement: null })).toBe(false);
    expect(xboxTitleHasProgress(null)).toBe(false);
  });

  it('drops a title with zero on both counts', () => {
    expect(xboxTitleHasProgress({ achievement: { totalAchievements: 0, currentAchievements: 0 } })).toBe(false);
    expect(xboxTitleHasProgress({ achievement: {} })).toBe(false);
  });
});

describe('resolveXboxTotal', () => {
  it('trusts a real total when titleHub supplies one', () => {
    expect(resolveXboxTotal({ totalAchievements: 50, currentAchievements: 19 }, 42)).toEqual({
      total: 50,
      totalUnreliable: false,
    });
  });

  it('prefers last run\'s corrected total when titleHub reports zero', () => {
    // Carrying the corrected value back in is what lets currentShard()
    // compare like with like and skip a refetch when nothing was earned.
    expect(resolveXboxTotal({ totalAchievements: 0, currentAchievements: 19 }, 42)).toEqual({
      total: 42,
      totalUnreliable: true,
    });
  });

  it('bootstraps from the earned count for a title seen for the first time', () => {
    expect(resolveXboxTotal({ totalAchievements: 0, currentAchievements: 19 }, undefined)).toEqual({
      total: 19,
      totalUnreliable: true,
    });
  });

  it('ignores a zero or missing prior total', () => {
    expect(resolveXboxTotal({ totalAchievements: 0, currentAchievements: 19 }, 0).total).toBe(19);
    expect(resolveXboxTotal({ totalAchievements: 0, currentAchievements: 19 }, null).total).toBe(19);
  });

  it('bootstraps to zero when there is nothing to go on', () => {
    expect(resolveXboxTotal({ totalAchievements: 0 }, undefined)).toEqual({ total: 0, totalUnreliable: true });
  });

  it('always flags a bootstrap total as unreliable, so the correction pass runs', () => {
    // Left unflagged, the bootstrap total equals the earned count and the
    // game reads as 100% complete — and it does not self-heal, since the
    // next run takes that same number back in as priorTotal.
    expect(resolveXboxTotal({ totalAchievements: 0, currentAchievements: 19 }, 19).totalUnreliable).toBe(true);
  });
});

describe('xboxUnlockedAt', () => {
  it('keeps a real unlock timestamp as-is', () => {
    expect(xboxUnlockedAt('2024-03-01T10:00:00.0000000Z')).toBe('2024-03-01T10:00:00.0000000Z');
  });

  it('nulls .NET DateTime.MinValue, the modern contract\'s placeholder', () => {
    expect(xboxUnlockedAt('0001-01-01T00:00:00.0000000Z')).toBeNull();
  });

  it('nulls SQL Server\'s minimum date, the legacy contract\'s placeholder', () => {
    expect(xboxUnlockedAt('1753-01-01T00:00:00.0000000Z')).toBeNull();
  });

  it('nulls a missing value', () => {
    expect(xboxUnlockedAt(null)).toBeNull();
    expect(xboxUnlockedAt(undefined)).toBeNull();
    expect(xboxUnlockedAt('')).toBeNull();
  });

  it('nulls an unparseable value rather than passing NaN downstream', () => {
    expect(xboxUnlockedAt('not a date')).toBeNull();
  });

  it('rejects any pre-2000 sentinel, not just the two known ones', () => {
    // Checking the year rather than a string prefix is what makes this
    // hold for a placeholder nobody has seen yet.
    expect(xboxUnlockedAt('1900-01-01T00:00:00Z')).toBeNull();
    expect(xboxUnlockedAt('1980-06-15T12:00:00Z')).toBeNull();
  });

  it('keeps every timestamp from the era Xbox achievements actually exist in', () => {
    // The cutoff is compared with getFullYear(), which reads local time,
    // so the exact 2000 boundary lands a few hours either side depending
    // on the runner's timezone. That is only reachable by a timestamp
    // within hours of midnight 2000 — 5 years before Xbox 360 launched,
    // and 250+ years from the nearest sentinel — so it is not asserted.
    for (const stamp of ['2005-11-22T00:00:00Z', '2015-01-01T12:00:00Z', '2026-08-26T09:00:00Z']) {
      expect(xboxUnlockedAt(stamp)).toBe(stamp);
    }
  });
});

describe('mapXboxModern', () => {
  const row = (over = {}) => ({
    id: 5,
    name: 'Pathfinder',
    description: 'You found the path',
    lockedDescription: 'Find the path',
    isSecret: false,
    rewards: [{ type: 'Gamerscore', value: '25' }],
    progressState: 'NotStarted',
    progression: { timeUnlocked: '0001-01-01T00:00:00.0000000Z' },
    rarity: { currentPercentage: 41.2345 },
    ...over,
  });

  it('prefers the locked description — the picker is asking you to go earn it', () => {
    expect(mapXboxModern(row()).description).toBe('Find the path');
  });

  it('falls back to the unlocked description, then to empty', () => {
    expect(mapXboxModern(row({ lockedDescription: '' })).description).toBe('You found the path');
    expect(mapXboxModern(row({ lockedDescription: '', description: '' })).description).toBe('');
  });

  it('reads earned from progressState', () => {
    expect(mapXboxModern(row()).earned).toBe(false);
    expect(mapXboxModern(row({ progressState: 'Achieved' })).earned).toBe(true);
    expect(mapXboxModern(row({ progressState: 'InProgress' })).earned).toBe(false);
  });

  it('pulls gamerscore out of the rewards array', () => {
    expect(mapXboxModern(row()).points).toBe(25);
    expect(mapXboxModern(row({ rewards: [{ type: 'Art', value: '1' }] })).points).toBeNull();
    expect(mapXboxModern(row({ rewards: undefined })).points).toBeNull();
  });

  it('nulls a zero gamerscore rather than reporting 0', () => {
    expect(mapXboxModern(row({ rewards: [{ type: 'Gamerscore', value: '0' }] })).points).toBeNull();
  });

  it('carries rarity through and nulls it when absent', () => {
    expect(mapXboxModern(row()).rarity).toBe(41.2345);
    expect(mapXboxModern(row({ rarity: undefined })).rarity).toBeNull();
  });

  it('drops the unlock sentinel and stringifies the id', () => {
    expect(mapXboxModern(row())).toMatchObject({ id: '5', earnedAt: null });
    expect(mapXboxModern(row({ progression: { timeUnlocked: '2024-05-05T00:00:00Z' } })).earnedAt).toBe(
      '2024-05-05T00:00:00Z',
    );
  });

  it('marks hidden only on an explicit isSecret', () => {
    expect(mapXboxModern(row({ isSecret: true })).hidden).toBe(true);
    expect(mapXboxModern(row({ isSecret: undefined })).hidden).toBe(false);
  });
});

describe('mapXboxLegacy', () => {
  const row = (over = {}) => ({
    id: 7,
    name: 'Old Timer',
    description: 'Play the game',
    isSecret: false,
    gamerscore: 10,
    unlocked: false,
    timeUnlocked: '1753-01-01T00:00:00.0000000Z',
    rarity: { currentPercentage: 8.88 },
    ...over,
  });

  it('prefers the plain description on the legacy shape', () => {
    expect(mapXboxLegacy(row()).description).toBe('Play the game');
    expect(mapXboxLegacy(row({ description: '', lockedDescription: 'hint' })).description).toBe('hint');
  });

  it('reads earned from the unlocked flag', () => {
    expect(mapXboxLegacy(row()).earned).toBe(false);
    expect(mapXboxLegacy(row({ unlocked: true })).earned).toBe(true);
  });

  it('reads points from the flat gamerscore field', () => {
    expect(mapXboxLegacy(row()).points).toBe(10);
    expect(mapXboxLegacy(row({ gamerscore: 0 })).points).toBeNull();
  });

  it('drops the legacy 1753 sentinel', () => {
    expect(mapXboxLegacy(row()).earnedAt).toBeNull();
    expect(mapXboxLegacy(row({ unlocked: true, timeUnlocked: '2011-06-01T00:00:00Z' })).earnedAt).toBe(
      '2011-06-01T00:00:00Z',
    );
  });

  it('carries the rarity that contract v3 added over v1', () => {
    expect(mapXboxLegacy(row()).rarity).toBe(8.88);
    expect(mapXboxLegacy(row({ rarity: undefined })).rarity).toBeNull();
  });
});

describe('mergeXboxAchievements', () => {
  const a = (id, over = {}) => ({
    id: String(id),
    name: `Ach ${id}`,
    description: '',
    hidden: false,
    points: 10,
    earned: false,
    earnedAt: null,
    rarity: null,
    ...over,
  });

  it('takes entries from the definitions list when it knows about more', () => {
    const defs = [a(1), a(2), a(3)];
    const player = [a(1, { earned: true, earnedAt: '2024-01-01T00:00:00Z' })];
    const got = mergeXboxAchievements(defs, player, player);
    expect(got.map((x) => x.id)).toEqual(['1', '2', '3']);
  });

  it('overlays unlock state from the earned-only list', () => {
    const defs = [a(1), a(2)];
    const player = [a(1, { earned: true, earnedAt: '2024-01-01T00:00:00Z' })];
    const got = mergeXboxAchievements(defs, player, player);
    expect(got[0]).toMatchObject({ earned: true, earnedAt: '2024-01-01T00:00:00Z' });
    expect(got[1]).toMatchObject({ earned: false, earnedAt: null });
  });

  it('joins the old-gen catalog against the legacy earned list, not the modern one', () => {
    // The legacy and modern contracts number the same achievements
    // differently. Joining across schemes marks every entry unearned —
    // the exact bug this shape exists to prevent.
    const legacyDefs = [a(1), a(2), a(3)];
    const legacyEarned = [a(2, { earned: true, earnedAt: '2011-06-01T00:00:00Z' })];
    const modernPlayer = [a('9821730-4c1f', { earned: true, earnedAt: '2011-06-01T00:00:00Z' })];

    const got = mergeXboxAchievements(legacyDefs, modernPlayer, legacyEarned);
    expect(got.filter((x) => x.earned).map((x) => x.id)).toEqual(['2']);
  });

  it('uses the player list as its own unlock source when it is the longer one', () => {
    const defs = [a(1)];
    const player = [a(1, { earned: true }), a(2, { earned: true }), a(3)];
    const got = mergeXboxAchievements(defs, player, []);
    expect(got.map((x) => x.id)).toEqual(['1', '2', '3']);
    expect(got.filter((x) => x.earned).map((x) => x.id)).toEqual(['1', '2']);
  });

  it('prefers the definition list on a tie, since it carries locked text', () => {
    const defs = [a(1, { description: 'Find the path' })];
    const player = [a(1, { description: '', earned: true })];
    expect(mergeXboxAchievements(defs, player, player)[0].description).toBe('Find the path');
  });

  it('keeps the definition rarity and borrows it only when absent', () => {
    const defs = [a(1, { rarity: 12.5 }), a(2, { rarity: null })];
    const player = [a(1, { earned: true, rarity: 99 }), a(2, { earned: true, rarity: 40 })];
    const got = mergeXboxAchievements(defs, player, player);
    expect(got[0].rarity).toBe(12.5);
    expect(got[1].rarity).toBe(40);
  });

  it('ignores unearned rows in the unlock source', () => {
    const defs = [a(1)];
    const player = [a(1, { earned: false, earnedAt: '2024-01-01T00:00:00Z' })];
    expect(mergeXboxAchievements(defs, player, player)[0]).toMatchObject({ earned: false, earnedAt: null });
  });

  it('ignores an unlock row with no matching definition', () => {
    const got = mergeXboxAchievements([a(1), a(2)], [a(99, { earned: true })], [a(99, { earned: true })]);
    expect(got.filter((x) => x.earned)).toHaveLength(0);
  });

  it('returns null when every call came back empty, so the old shard is kept', () => {
    expect(mergeXboxAchievements([], [], [])).toBeNull();
  });

  it('does not mutate its inputs', () => {
    const defs = [a(1)];
    const player = [a(1, { earned: true })];
    mergeXboxAchievements(defs, player, player);
    expect(defs[0].earned).toBe(false);
  });
});

describe('listDisagreesWithLibrary', () => {
  const list = (earned, total) =>
    Array.from({ length: total }, (_, i) => ({ id: String(i), earned: i < earned }));

  it('accepts a list that matches the library counts', () => {
    expect(listDisagreesWithLibrary(list(19, 50), { earned: 19, total: 50 })).toBe(false);
  });

  it('rejects a full definition list that came back with no unlock state', () => {
    // One of the two upstream calls half-failed: get() swallows errors
    // into [], so the definitions arrived and the progress did not.
    expect(listDisagreesWithLibrary(list(0, 50), { earned: 19, total: 50 })).toBe(true);
  });

  it('rejects a short all-earned list under a full total', () => {
    // The mirror failure — the app's weighted completion reads this as
    // 100% and ranks an unfinished game as cleared.
    expect(listDisagreesWithLibrary(list(19, 19), { earned: 19, total: 50 })).toBe(true);
  });

  it('rejects a list whose length disagrees with the total', () => {
    expect(listDisagreesWithLibrary(list(19, 49), { earned: 19, total: 50 })).toBe(true);
  });

  it('checks only the earned half for an Xbox bootstrap total', () => {
    // The total is a guess main()'s correction pass trues up from this
    // very shard — holding the write to it would reject the write that
    // pass reads back, and the title would never get corrected.
    const entry = { earned: 19, total: 19, totalUnreliable: true };
    expect(listDisagreesWithLibrary(list(19, 50), entry)).toBe(false);
    expect(listDisagreesWithLibrary(list(18, 50), entry)).toBe(true);
  });

  it('accepts an untouched game with a full definition list', () => {
    expect(listDisagreesWithLibrary(list(0, 50), { earned: 0, total: 50 })).toBe(false);
  });

  it('accepts a fully completed game', () => {
    expect(listDisagreesWithLibrary(list(50, 50), { earned: 50, total: 50 })).toBe(false);
  });
});
