// @vitest-environment node
//
// Three functions in this repo exist twice on purpose: once in
// src/utils/*.ts for the browser bundle, once in scripts/*.mjs for the
// Node-side nightly build, because a .ts module can't be imported into
// a plain script and the script can't be imported into the bundle. Each
// copy carries a comment saying it must be kept in sync by hand.
//
// This suite is what actually enforces that. Editing one copy and not
// the other is the single most likely silent regression here — the app
// would keep rendering, the build would keep succeeding, and the
// leaderboard would just quietly disagree with the bars on the cards.
import { describe, expect, it } from 'vitest';

import { normalizeTitle as normalizeTs } from '../src/utils/achievementMatch';
import { achievementScore as scoreTs } from '../src/utils/achievementScore';
import { buildGameScoreContext } from '../src/utils/leaderboardCompletion';
import type { AchievementEntry } from '../src/types/game';

import {
  achievementScore as scoreLeaderboard,
  normalizeTitle as normalizeMjs,
  weightedCompletion,
} from '../scripts/build-leaderboard.mjs';
import { achievementScore as scoreTimeline } from '../scripts/build-timeline.mjs';

// A deterministic generator, so a parity break is reproducible rather
// than a flake that shows up on one CI run in ten.
function makeRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const TITLE_CORPUS = [
  'Portal 2',
  'The Last of Us Part II',
  'Theme Park World',
  "Assassin's Creed: Origins",
  'DOOM® Eternal™',
  'Portal©',
  'FINAL FANTASY',
  'FINAL FANTASY ⅱ',
  'FINAL FANTASY ⅶ',
  'FINAL FANTASY ⅻ',
  'Geometry Wars Evolved²',
  'Geometry Wars Evolved',
  'NieR:Automata',
  'NieR: Automata™',
  'Deus Ex - Human Revolution',
  'Final Fantasy VII Remake',
  'The Witcher® 3: Wild Hunt™',
  'Ⅹ⁵ mixed ⁰ glyphs ⅺ',
  'the the the',
  'The  Double Space',
  '   Leading Whitespace',
  '日本語タイトル',
  '',
  '!!!',
  '2064: Read Only Memories',
];

describe('normalizeTitle stays identical in src/utils and scripts/', () => {
  it.each(TITLE_CORPUS)('matches on %j', (title) => {
    expect(normalizeMjs(title)).toBe(normalizeTs(title));
  });

  it('matches over a random ASCII corpus', () => {
    const random = makeRandom(20260826);
    const alphabet = "abcXYZ 019:-'®™Ⅱ²the ";
    for (let i = 0; i < 500; i++) {
      const len = Math.floor(random() * 20);
      let title = '';
      for (let j = 0; j < len; j++) {
        title += alphabet[Math.floor(random() * alphabet.length)];
      }
      expect(normalizeMjs(title), `title: ${JSON.stringify(title)}`).toBe(normalizeTs(title));
    }
  });
});

describe('achievementScore stays identical across all three copies', () => {
  const rarities = [
    null, undefined, 0, -1, 0.001, 0.1, 0.5, 1, 1.0001, 2, 4, 10, 25, 33.3, 50, 75, 99.9, 100,
  ];

  it.each(rarities)('matches at rarity %s', (rarity) => {
    const expected = scoreTs(rarity as number | null | undefined);
    expect(scoreLeaderboard(rarity)).toBe(expected);
    expect(scoreTimeline(rarity)).toBe(expected);
  });

  it('matches over a random rarity sweep', () => {
    const random = makeRandom(11235813);
    for (let i = 0; i < 500; i++) {
      const rarity = Math.round(random() * 1000) / 10;
      expect(scoreLeaderboard(rarity), `rarity: ${rarity}`).toBe(scoreTs(rarity));
      expect(scoreTimeline(rarity), `rarity: ${rarity}`).toBe(scoreTs(rarity));
    }
  });
});

describe('weighted completion stays identical in src/utils and scripts/', () => {
  const completionTs = (platform: 'steam' | 'psn' | 'xbox' | 'ra', all: AchievementEntry[]) =>
    buildGameScoreContext(platform, all)?.completion ?? null;

  const cases: Array<[string, 'steam' | 'psn' | 'xbox' | 'ra', Partial<AchievementEntry>[]]> = [
    ['steam half done', 'steam', [{ earned: true }, {}]],
    ['steam complete', 'steam', [{ earned: true }, { earned: true }]],
    ['steam untouched', 'steam', [{}, {}, {}]],
    ['psn tiers', 'psn', [
      { earned: true, type: 'platinum' }, { type: 'bronze' }, { type: 'silver' }, { type: 'gold' },
    ]],
    ['psn mixed case tiers', 'psn', [{ earned: true, type: 'GOLD' }, { type: 'Bronze' }]],
    ['psn unknown tier', 'psn', [{ earned: true, type: 'mythic' }, { type: null }]],
    ['psn missing tier', 'psn', [{ earned: true }, {}]],
    ['xbox points', 'xbox', [{ earned: true, points: 90 }, { points: 10 }]],
    ['xbox all zero points', 'xbox', [{ earned: true, points: 0 }, { points: 0 }, { points: 0 }]],
    ['xbox null points', 'xbox', [{ earned: true, points: null }, { points: null }]],
    ['xbox zero-weight tail', 'xbox', [{ earned: true, points: 50 }, { points: 0 }, { points: 0 }]],
    ['xbox complete', 'xbox', [{ earned: true, points: 50 }, { earned: true, points: 0 }]],
    ['ra points', 'ra', [{ earned: true, points: 25 }, { points: 5 }, { points: 5 }]],
    ['single unearned', 'steam', [{}]],
    ['single earned', 'psn', [{ earned: true, type: 'bronze' }]],
  ];

  const fill = (over: Partial<AchievementEntry>, i: number): AchievementEntry => ({
    id: `a${i}`,
    name: `Achievement ${i}`,
    description: '',
    hidden: false,
    earned: false,
    earnedAt: null,
    rarity: 50,
    ...over,
  });

  it.each(cases)('matches for %s', (_label, platform, partials) => {
    const all = partials.map(fill);
    expect(weightedCompletion(platform, all)).toBeCloseTo(completionTs(platform, all)!, 12);
  });

  it('matches over a random library sweep', () => {
    const random = makeRandom(31415926);
    const tiers = ['bronze', 'silver', 'gold', 'platinum', 'mythic', null];
    const platforms = ['steam', 'psn', 'xbox', 'ra'] as const;

    for (let i = 0; i < 400; i++) {
      const platform = platforms[Math.floor(random() * platforms.length)];
      const count = 1 + Math.floor(random() * 12);
      const all = Array.from({ length: count }, (_, j) =>
        fill(
          {
            earned: random() < 0.5,
            type: tiers[Math.floor(random() * tiers.length)],
            // Deliberately weighted toward 0 so the zero-weight
            // fallback path gets exercised on both sides.
            points: random() < 0.4 ? 0 : Math.floor(random() * 100),
          },
          j,
        ),
      );
      const label = `${platform} ${JSON.stringify(all.map((a) => [a.earned, a.type, a.points]))}`;
      expect(weightedCompletion(platform, all), label).toBeCloseTo(completionTs(platform, all)!, 12);
    }
  });

  it('never reports a completion outside 0..1 on either side', () => {
    const random = makeRandom(27182818);
    for (let i = 0; i < 200; i++) {
      const all = Array.from({ length: 1 + Math.floor(random() * 8) }, (_, j) =>
        fill({ earned: random() < 0.5, points: Math.floor(random() * 50) }, j),
      );
      const value = weightedCompletion('xbox', all);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});
