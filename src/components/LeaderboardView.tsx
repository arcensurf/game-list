import { useMemo, useState } from 'react';
import type React from 'react';
import { useLeaderboard } from '../hooks/useLeaderboard';
import { useGameSearchIndex } from '../hooks/useGameSearchIndex';
import { pickerCoverUrl, steamCoverFallback } from '../utils/pickerCover';
import { ACHIEVEMENT_PLATFORM_COLORS_LIGHT } from '../utils/platformColors';
import xboxLogo from '../icons/svg/outline/xbox.svg';
import type { ShardPlatform } from '../hooks/useAchievementList';
import type { LeaderboardGame } from '../types/game';
import { PLATFORMS } from '../hooks/useTrophyPicker';
import LeaderboardGameModal from './LeaderboardGameModal';
import { useInView } from '../hooks/useInView';
import LampToggle from './LampToggle';
import type { LeaderboardModalTarget } from './LeaderboardGameModal';
import DuplicateGroupsOverlay from './DuplicateGroupsOverlay';
import ScoringInfoModal from './ScoringInfoModal';
import PlatformPill from './PlatformPill';
import { PLATFORM_LABELS, formatDate } from '../utils/leaderboardFormat';

const SEARCH_RESULTS_LIMIT = 8;
const SKELETON_ROWS = Array.from({ length: 8 }, (_, i) => i);
// Caps how far the entrance stagger climbs — without this, row 150 of
// a 200-row list would start rising in nearly six seconds after mount.
const MAX_STAGGER_INDEX = 14;

// Strips trademark clutter (DiRT™, DIRT5™, ...) so it doesn't throw off
// either the exact-match check or the alphabetical tiebreak below.
function normalizeForMatch(title: string): string {
  return title.toLowerCase().replace(/[™®©]/g, '').replace(/\s+/g, ' ').trim();
}

// Plain substring search ranks purely alphabetically, which buries a
// short exact title under its own numbered sequels ("DiRT" search
// filling up with "DiRT 2".."DiRT Showdown" before "DiRT" itself gets a
// turn) — and once the whole title's been typed there's no more query
// left to narrow it further. Ranking exact/prefix/word-boundary matches
// ahead of a bare substring hit fixes that without needing more input.
function matchRank(title: string, query: string): number {
  const norm = normalizeForMatch(title);
  if (norm === query) return 0;
  if (norm.startsWith(query)) return 1;
  const idx = norm.indexOf(query);
  if (idx > 0 && !/[a-z0-9]/i.test(norm[idx - 1])) return 2;
  return 3;
}

// Per-device preference, not real state — worth remembering across a
// reload, not worth syncing anywhere. Mirrors the picker's own
// platform-toggle persistence (see TrophyPickerView).
const PLATFORMS_KEY = 'game-list:leaderboard-platforms';

function readStoredPlatforms(): ShardPlatform[] {
  try {
    const raw = localStorage.getItem(PLATFORMS_KEY);
    if (!raw) return PLATFORMS;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return PLATFORMS;
    const kept = PLATFORMS.filter((p) => parsed.includes(p));
    return kept.length > 0 ? kept : PLATFORMS;
  } catch {
    // Private windows and blocked site data both throw on access.
    return PLATFORMS;
  }
}

// Same fallback chain as the picker's Cover component, minus the SGDB
// live lookup — that goes through a dev-only API route with nothing
// backing it on the deployed site, and this view is public.
function Thumb({
  platform,
  gameId,
  icon,
}: {
  platform: ShardPlatform;
  gameId: string;
  icon: string | null;
}) {
  const frameRef = useInView<HTMLSpanElement>();
  const [src, setSrc] = useState(pickerCoverUrl(platform, gameId, icon));
  if (!src) {
    // Xbox is the one platform where titleHub sometimes just omits box art
    // for a title (not a broken URL, an absent one — nothing for the
    // fetch-time re-hosting in fetch-achievements.mjs to act on), so it
    // gets a generic logo instead of an empty slot. Rare enough for the
    // other platforms that it isn't worth sourcing matching logos for them.
    if (platform === 'xbox') {
      return (
        <span className="leaderboard-thumb-frame" ref={frameRef}>
          <div className="leaderboard-thumb leaderboard-thumb--fallback">
          <span
            className="leaderboard-thumb--fallback-icon"
            style={{ maskImage: `url(${xboxLogo})`, WebkitMaskImage: `url(${xboxLogo})` }}
            />
          </div>
        </span>
      );
    }
    return (
      <span className="leaderboard-thumb-frame" ref={frameRef}>
        <div className="leaderboard-thumb leaderboard-thumb--empty" />
      </span>
    );
  }
  return (
    <span className="leaderboard-thumb-frame" ref={frameRef}>
      <img
        className="leaderboard-thumb"
        src={src}
        alt=""
        onError={() => {
          const fallback = steamCoverFallback(gameId);
          if (platform === 'steam' && src !== fallback) setSrc(fallback);
          else if (icon && src !== icon) setSrc(icon);
          else setSrc(null);
        }}
      />
    </span>
  );
}

type Tab = 'games' | 'rarest';

// Matches the per-platform caps in scripts/build-leaderboard.mjs — the
// data already ships each platform's own top N, so filtering down to
// one platform still has a full list to slice from here.
const GAMES_DISPLAY_LIMIT = 100;
const RAREST_DISPLAY_LIMIT = 200;

export default function LeaderboardView({
  hideDupes,
  completionsOnly,
}: {
  hideDupes: boolean;
  completionsOnly: boolean;
}) {
  const { data, loading } = useLeaderboard();
  // Activated on first search focus or on opening the dev duplicate
  // review tool — the only two consumers of the game search index —
  // rather than fetched unconditionally on mount (see the hook).
  const [searchIndexActive, setSearchIndexActive] = useState(false);
  const { games: searchIndex, loading: searchIndexLoading } = useGameSearchIndex(searchIndexActive);
  const [tab, setTab] = useState<Tab>('games');
  const [modalTarget, setModalTarget] = useState<LeaderboardModalTarget | null>(null);
  const [enabledPlatforms, setEnabledPlatforms] = useState<ShardPlatform[]>(readStoredPlatforms);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  // Dev-only: lets the loading skeleton and its entrance animation be
  // re-triggered on demand while iterating on them, instead of needing
  // a full reload every time.
  const [previewLoading, setPreviewLoading] = useState(false);
  // Collapses every dev affordance on this view behind one switch, so the
  // page can be previewed as a visitor sees it without a rebuild.
  const [devOpen, setDevOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);

  // Independent of the leaderboard lists below — those only carry each
  // platform's top N (see GAMES_LIMIT_PER_PLATFORM in
  // build-leaderboard.mjs), so a game outside that cut just isn't in
  // `data` at all. This searches every scored game instead, straight out
  // of achievements.json, and opens the same modal on a pick — which
  // computes its score live from the shard, so it works whether or not
  // the game made the leaderboard cut.
  const trimmedQuery = query.trim().toLowerCase();
  const searchMatches = useMemo(() => {
    if (!trimmedQuery) return [];
    return searchIndex
      .filter((g) => enabledPlatforms.includes(g.platform) && normalizeForMatch(g.title).includes(trimmedQuery))
      .sort((a, b) => {
        const rankDiff = matchRank(a.title, trimmedQuery) - matchRank(b.title, trimmedQuery);
        if (rankDiff !== 0) return rankDiff;
        if (a.title.length !== b.title.length) return a.title.length - b.title.length;
        return a.title.localeCompare(b.title);
      })
      .slice(0, SEARCH_RESULTS_LIMIT + 1);
  }, [searchIndex, enabledPlatforms, trimmedQuery]);
  const showSearchDropdown = searchFocused && trimmedQuery.length > 0;

  // Keyed off the full, unfiltered game list (not the platform-toggled
  // `games` below) so a group's other copies are still switchable from
  // the modal even if their platform is currently hidden — e.g. you're
  // viewing Steam-only but want to check the PSN progress you built up
  // before switching platforms.
  const dupeGroups = useMemo(() => {
    const map = new Map<string, LeaderboardGame[]>();
    for (const g of data?.games ?? []) {
      if (!g.dupeKey) continue;
      const list = map.get(g.dupeKey) ?? [];
      list.push(g);
      map.set(g.dupeKey, list);
    }
    for (const list of map.values()) list.sort((a, b) => b.score - a.score);
    return map;
  }, [data]);

  // Search results come from achievements.json directly (see
  // useGameSearchIndex) and don't carry a dupeKey of their own, so look
  // it up by platform/id against the same game list dupeGroups was built
  // from — lets a search-picked game open the modal with its group's
  // switcher too, not just games clicked straight off the list.
  const dupeKeyByGame = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of data?.games ?? []) {
      if (g.dupeKey) map.set(`${g.platform}/${g.id}`, g.dupeKey);
    }
    return map;
  }, [data]);

  const togglePlatform = (platform: ShardPlatform) => {
    setEnabledPlatforms((prev) => {
      const on = prev.includes(platform);
      // At least one platform must stay on, or the list goes empty with
      // no way back short of clearing storage.
      if (on && prev.length === 1) return prev;
      const next = on ? prev.filter((p) => p !== platform) : [...prev, platform];
      try {
        localStorage.setItem(PLATFORMS_KEY, JSON.stringify(next));
      } catch {
        // Not worth interrupting anyone over.
      }
      return next;
    });
  };

  if (loading || previewLoading) {
    return (
      <div className="leaderboard-view">
        <div className="leaderboard-header">
          <div className="leaderboard-title-row">
            <h2>Leaderboard</h2>
          </div>
        </div>
        <ol className="leaderboard-list" aria-hidden="true">
          {SKELETON_ROWS.map((i) => (
            <li
              key={i}
              className="leaderboard-row leaderboard-row--skeleton"
              style={{ ['--row-index' as string]: i } as React.CSSProperties}
            >
              <span className="leaderboard-skeleton leaderboard-skeleton--rank" />
              <span className="leaderboard-skeleton leaderboard-skeleton--thumb" />
              <div className="leaderboard-main">
                <span className="leaderboard-skeleton leaderboard-skeleton--title" />
                <span className="leaderboard-skeleton leaderboard-skeleton--meta" />
              </div>
              <span className="leaderboard-skeleton leaderboard-skeleton--score" />
            </li>
          ))}
        </ol>
      </div>
    );
  }
  if (!data) {
    return (
      <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '4rem 0' }}>
        Could not load leaderboard data.
      </p>
    );
  }

  // The shipped data is each platform's own top N, not a single
  // pre-sorted global list, so filtering down needs a re-sort — and a
  // re-slice, since e.g. two platforms selected together can offer more
  // than the display cap once merged.
  // Completions are filtered out before the dedup below, not after:
  // a game finished on one platform and abandoned on another would
  // otherwise collapse to whichever copy scored higher — hiding the
  // 100% run behind the unfinished one.
  let games = data.games
    .filter((g) => enabledPlatforms.includes(g.platform))
    .filter((g) => !completionsOnly || g.earned === g.total)
    .sort((a, b) => b.score - a.score);
  if (hideDupes) {
    // Sorted descending, so the first row seen for a given dupeKey is
    // always its highest scorer — nothing left to recompute. A game
    // whose duplicate got filtered out by the platform toggle above
    // just never collides with anything here, which is the right
    // behavior: dedup only ever collapses what's currently visible.
    const seen = new Set<string>();
    games = games.filter((g) => {
      if (!g.dupeKey) return true;
      if (seen.has(g.dupeKey)) return false;
      seen.add(g.dupeKey);
      return true;
    });
  }
  games = games.slice(0, GAMES_DISPLAY_LIMIT);
  const rarestAchievements = data.rarestAchievements
    .filter((a) => enabledPlatforms.includes(a.platform))
    .sort((a, b) => a.rarity - b.rarity)
    .slice(0, RAREST_DISPLAY_LIMIT);

  return (
    <div className="leaderboard-view">
      <div className="leaderboard-header">
        <div className="leaderboard-title-row">
          <h2>Leaderboard</h2>
          <button
            type="button"
            className="leaderboard-info-btn"
            onClick={() => setInfoOpen(true)}
            aria-label="How scoring works"
            title="How scoring works"
          >
            ?
          </button>
          {import.meta.env.DEV && (
            <LampToggle
              className="leaderboard-dev-lamp"
              on={devOpen}
              label="Dev"
              title={devOpen ? 'Hide dev controls' : 'Show dev controls'}
              onClick={() => setDevOpen((v) => !v)}
            />
          )}
          <div className="leaderboard-search-wrap trace-b">
            <input
              className="leaderboard-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => {
                setSearchFocused(true);
                setSearchIndexActive(true);
              }}
              onBlur={() => setSearchFocused(false)}
              placeholder="Find a game's score…"
              aria-label="Find a game"
            />
            {showSearchDropdown && (
              <ul className="leaderboard-search-dropdown" role="listbox">
                {searchIndexLoading && searchMatches.length === 0 && (
                  <li className="leaderboard-search-empty">Loading…</li>
                )}
                {!searchIndexLoading && searchMatches.length === 0 && (
                  <li className="leaderboard-search-empty">No games match &ldquo;{query.trim()}&rdquo;.</li>
                )}
                {searchMatches.slice(0, SEARCH_RESULTS_LIMIT).map((g) => (
                  <li
                    key={`${g.platform}/${g.id}`}
                    role="option"
                    aria-selected={false}
                    className="leaderboard-search-option"
                    // Keeps the input focused through the click so the
                    // blur handler above doesn't close the dropdown first.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setModalTarget({
                        platform: g.platform,
                        id: g.id,
                        title: g.title,
                        dupeKey: dupeKeyByGame.get(`${g.platform}/${g.id}`) ?? null,
                      });
                      setQuery('');
                      setSearchFocused(false);
                    }}
                  >
                    <PlatformPill platform={g.platform} />
                    <span className="leaderboard-search-option-title">{g.title}</span>
                    <span className="leaderboard-search-option-meta">
                      {g.earned}/{g.total}
                    </span>
                  </li>
                ))}
                {searchMatches.length > SEARCH_RESULTS_LIMIT && (
                  <li className="leaderboard-search-empty">Keep typing to narrow it down…</li>
                )}
              </ul>
            )}
          </div>
          {/* Dev tools sit top-right of the view, out of the filter row —
              same placement as the Stats view's preview control. */}
          {import.meta.env.DEV && devOpen && (
            <div className="leaderboard-dev-tools">
              {tab === 'games' && (
                <button
                  type="button"
                  className="dev-btn"
                  onClick={() => {
                    setSearchIndexActive(true);
                    setGroupsOpen(true);
                  }}
                >
                  Review duplicates
                </button>
              )}
              <button
                type="button"
                className="dev-btn"
                onClick={() => {
                  setPreviewLoading(true);
                  setTimeout(() => setPreviewLoading(false), 2000);
                }}
                disabled={previewLoading}
              >
                Preview loading
              </button>
            </div>
          )}
        </div>
        {import.meta.env.DEV && devOpen && (
          <p className="leaderboard-dev-hint">
            Local data is a snapshot from the last <code>npm run pull-data</code> — run it again if this looks stale.
          </p>
        )}
        <div className="leaderboard-controls">
          <div className="leaderboard-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={tab === 'games'}
              className={`leaderboard-tab${tab === 'games' ? ' leaderboard-tab--active' : ''}`}
              onClick={() => setTab('games')}
            >
              Top Games
            </button>
            <button
              role="tab"
              aria-selected={tab === 'rarest'}
              className={`leaderboard-tab${tab === 'rarest' ? ' leaderboard-tab--active' : ''}`}
              onClick={() => setTab('rarest')}
            >
              Rarest Unlocks
            </button>
          </div>

          <div className="leaderboard-platform-toggles" role="group" aria-label="Platforms to show">
            {PLATFORMS.map((p) => {
              const on = enabledPlatforms.includes(p);
              return (
                <LampToggle
                  key={p}
                  className="leaderboard-platform-toggle"
                  on={on}
                  // The light map: a lit key has to be distinguishable from an
                // unlit one, and base PSN (#003087) is 1.46:1 against the
                // unlit key's --bg-card — a lamp you cannot tell is on.
                color={ACHIEVEMENT_PLATFORM_COLORS_LIGHT[p]}
                  label={PLATFORM_LABELS[p]}
                  title={on ? `Hide ${PLATFORM_LABELS[p]}` : `Show ${PLATFORM_LABELS[p]}`}
                  onClick={() => togglePlatform(p)}
                />
              );
            })}
          </div>
        </div>

      </div>

      {tab === 'games' && games.length === 0 ? (
        <p className="leaderboard-empty">
          {completionsOnly ? 'No completions on the selected platforms yet.' : 'No games match this platform filter.'}
        </p>
      ) : tab === 'games' ? (
        <ol className="leaderboard-list leaderboard-list--progress">
          {games.map((g, i) => {
            const complete = g.earned === g.total;
            return (
              <li
                key={`${g.platform}/${g.id}`}
                className={`leaderboard-row${complete ? ' leaderboard-row--complete' : ''}`}
                // Staggers both the entrance rise (every row) and, for
                // completions, the foil's light-drift so a run of them
                // doesn't shimmer in lockstep — see .leaderboard-row and
                // .leaderboard-row--complete in leaderboard.css.
                style={{ ['--row-index' as string]: Math.min(i, MAX_STAGGER_INDEX) } as React.CSSProperties}
                role="button"
                tabIndex={0}
                onClick={() => setModalTarget({ platform: g.platform, id: g.id, title: g.title, dupeKey: g.dupeKey })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setModalTarget({ platform: g.platform, id: g.id, title: g.title, dupeKey: g.dupeKey });
                  }
                }}
              >
                {/* The row's colour, from the cover's dominant hue where the
                    build resolved one, and from blurring the cover itself
                    where it did not. Lit
                    on completions. Every row is a different colour
                    because every cover is — the thing a shared gradient
                    could never do. The thumbnail on top of it is what
                    makes the colour legible rather than arbitrary. */}
                {g.tint ? (
                  <span
                    className="leaderboard-row-art leaderboard-row-art--tint"
                    style={{ ['--row-tint' as string]: g.tint } as React.CSSProperties}
                    aria-hidden="true"
                  />
                ) : (
                  <img
                    className="leaderboard-row-art"
                    src={pickerCoverUrl(g.platform, g.id, g.icon) ?? undefined}
                    alt=""
                    aria-hidden="true"
                    loading="lazy"
                  />
                )}
                <span className="leaderboard-rank">{i + 1}</span>
                <Thumb platform={g.platform} gameId={g.id} icon={g.icon} />
                <div className="leaderboard-main">
                  <div className="leaderboard-title">{g.title}</div>
                  <div className="leaderboard-meta">
                    <PlatformPill platform={g.platform} />
                    <span className={`leaderboard-completion${complete ? ' leaderboard-completion--complete' : ''}`}>
                      {complete && '✓ '}
                      {g.earned}/{g.total} &middot; {g.completion}% complete
                    </span>
                  </div>
                </div>
                <span className="leaderboard-score">{Math.round(g.score).toLocaleString()}</span>
              </li>
            );
          })}
        </ol>
      ) : rarestAchievements.length === 0 ? (
        <p className="leaderboard-empty">No achievements match this platform filter.</p>
      ) : (
        <ol className="leaderboard-list">
          {rarestAchievements.map((a, i) => (
            <li
              key={`${a.platform}/${a.gameId}/${a.name}/${i}`}
              className="leaderboard-row"
              style={{ ['--row-index' as string]: Math.min(i, MAX_STAGGER_INDEX) } as React.CSSProperties}
              role="button"
              tabIndex={0}
              onClick={() => setModalTarget({ platform: a.platform, id: a.gameId, title: a.gameTitle })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setModalTarget({ platform: a.platform, id: a.gameId, title: a.gameTitle });
                }
              }}
            >
              <span className="leaderboard-rank">{i + 1}</span>
              <Thumb platform={a.platform} gameId={a.gameId} icon={a.icon} />
              <div className="leaderboard-main">
                <div className="leaderboard-title">{a.name}</div>
                <div className="leaderboard-meta">
                  <PlatformPill platform={a.platform} />
                  <span className="leaderboard-completion">
                    {a.gameTitle}
                    {a.earnedAt ? ` · earned ${formatDate(a.earnedAt)}` : ''}
                  </span>
                </div>
              </div>
              <span className="leaderboard-score">{a.rarity}%</span>
            </li>
          ))}
        </ol>
      )}

      <LeaderboardGameModal
        target={modalTarget}
        group={modalTarget?.dupeKey ? dupeGroups.get(modalTarget.dupeKey) : undefined}
        onClose={() => setModalTarget(null)}
      />
      <ScoringInfoModal open={infoOpen} onClose={() => setInfoOpen(false)} />
      {import.meta.env.DEV && (
        <DuplicateGroupsOverlay
          open={groupsOpen}
          onClose={() => setGroupsOpen(false)}
          searchIndex={searchIndex}
        />
      )}
    </div>
  );
}
