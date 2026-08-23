import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LeaderboardGame } from '../types/game';
import type { SearchableGame } from '../hooks/useGameSearchIndex';
import { shardKey } from '../hooks/useAchievementList';
import {
  loadGameLinks,
  saveGameLink,
  type GameLinkMember,
  type GameLinkPair,
  type GameLinks,
} from '../utils/gameLinks';
import { ACHIEVEMENT_PLATFORM_COLORS_LIGHT } from '../utils/platformColors';

const PLATFORM_LABELS: Record<string, string> = {
  steam: 'Steam',
  psn: 'PSN',
  xbox: 'Xbox',
  ra: 'RA',
};

function memberFromKey(key: string): GameLinkMember {
  const [platform, ...rest] = key.split('/');
  return { platform: platform as GameLinkMember['platform'], id: rest.join('/') };
}

/**
 * Review/adjust the leaderboard's cross-platform duplicate grouping.
 * Structurally a copy of MarksOverlay: a searchable flat list, a picker
 * flow for the one write action that isn't "remove this row". Reuses
 * MarksOverlay's ban-* CSS classes rather than adding new styles.
 *
 * Reads the full, unsliced game list from the dev-only /api/dupe-groups
 * route rather than leaderboard.json's own `games` — that file only
 * ships each platform's top N, so a real duplicate whose weaker copy
 * doesn't make that cut would otherwise be invisible here even though
 * assignDupeKeys already matched it correctly.
 *
 * Splitting a group member here only affects this overlay's own local
 * view (optimistic removal) — the real grouping lives in
 * assignDupeKeys (scripts/build-leaderboard.mjs) and only re-runs on
 * the next build, local or nightly. Same for a new merge: it's written
 * immediately, but won't show as a collapsed row on the live leaderboard
 * until that next build.
 */
export default function DuplicateGroupsOverlay({
  open,
  onClose,
  searchIndex,
}: {
  open: boolean;
  onClose: () => void;
  searchIndex: SearchableGame[];
}) {
  const [games, setGames] = useState<LeaderboardGame[]>([]);
  const [links, setLinks] = useState<GameLinks>({ merges: [], splits: [] });
  const [loading, setLoading] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [linking, setLinking] = useState(false);
  const [pickedA, setPickedA] = useState<SearchableGame | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setHidden(new Set());
    setLinking(false);
    setPickedA(null);
    setQuery('');
    setStatus(null);
    setLoading(true);
    Promise.all([
      fetch(`/api/dupe-groups?t=${Date.now()}`).then((res) => (res.ok ? res.json() : { games: [] })),
      loadGameLinks(),
    ]).then(([dupeGroups, linksData]: [{ games?: LeaderboardGame[] }, GameLinks]) => {
      setGames(dupeGroups.games ?? []);
      setLinks(linksData);
      setLoading(false);
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const titleByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of searchIndex) map.set(shardKey(g.platform, g.id), g.title);
    for (const g of games) map.set(shardKey(g.platform, g.id), g.title);
    return map;
  }, [searchIndex, games]);

  const groups = useMemo(() => {
    const byKey = new Map<string, LeaderboardGame[]>();
    for (const g of games) {
      const dupeKey = g.dupeKey;
      if (!dupeKey) continue;
      const memberKey = shardKey(g.platform, g.id);
      if (hidden.has(memberKey)) continue;
      const list = byKey.get(dupeKey) ?? [];
      list.push(g);
      byKey.set(dupeKey, list);
    }
    return [...byKey.values()]
      .filter((members) => members.length > 1)
      .map((members) => members.slice().sort((a, b) => b.score - a.score))
      .sort((a, b) => b[0].score - a[0].score);
  }, [games, hidden]);

  async function splitMember(group: LeaderboardGame[], member: LeaderboardGame) {
    const memberKey = shardKey(member.platform, member.id);
    const others = group.filter((g) => shardKey(g.platform, g.id) !== memberKey);
    try {
      let updated = links;
      for (const other of others) {
        updated = await saveGameLink(member, other, 'split');
      }
      setLinks(updated);
      setHidden((prev) => new Set(prev).add(memberKey));
      setStatus(`Split "${member.title}" out — takes effect on the next leaderboard build.`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed to split');
    }
  }

  async function removeLink(pair: GameLinkPair, kind: 'merges' | 'splits') {
    try {
      const updated = await saveGameLink(memberFromKey(pair[0]), memberFromKey(pair[1]), null);
      setLinks(updated);
      setStatus(`Removed ${kind === 'merges' ? 'merge' : 'split'} — takes effect on the next leaderboard build.`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed to remove link');
    }
  }

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const excludeKey = pickedA ? shardKey(pickedA.platform, pickedA.id) : null;
    return searchIndex
      .filter((g) => shardKey(g.platform, g.id) !== excludeKey && g.title.toLowerCase().includes(q))
      .slice(0, 8);
  }, [searchIndex, query, pickedA]);

  async function pickSecond(b: SearchableGame) {
    if (!pickedA) return;
    try {
      const updated = await saveGameLink(pickedA, b, 'merge');
      setLinks(updated);
      setStatus(`Linked "${pickedA.title}" (${pickedA.platform}) with "${b.title}" (${b.platform}) — takes effect on the next leaderboard build.`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed to link');
    }
    setLinking(false);
    setPickedA(null);
    setQuery('');
  }

  if (!open) return null;

  return createPortal(
    <div className="ban-overlay" onClick={onClose}>
      <div
        className="ban-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Duplicate games"
      >
        {linking ? (
          <>
            <div className="ban-head">
              <button
                className="manual-back"
                onClick={() => {
                  if (pickedA) setPickedA(null);
                  else setLinking(false);
                  setQuery('');
                }}
                aria-label="Back"
              >
                ←
              </button>
              <h2>{pickedA ? `Link with "${pickedA.title}"…` : 'Link games…'}</h2>
              <button className="ban-close" onClick={onClose} aria-label="Close">
                ×
              </button>
            </div>

            <input
              className="ban-search"
              type="search"
              autoFocus
              placeholder={pickedA ? 'Search for the other copy...' : 'Search for a game...'}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />

            <div className="ban-rows">
              {searchResults.map((g) => (
                <button
                  key={shardKey(g.platform, g.id)}
                  className="ban-row marks-row-btn"
                  onClick={() => {
                    if (pickedA) void pickSecond(g);
                    else {
                      setPickedA(g);
                      setQuery('');
                    }
                  }}
                >
                  <span
                    className="ban-row-platform"
                    style={{ color: ACHIEVEMENT_PLATFORM_COLORS_LIGHT[g.platform] }}
                  >
                    {PLATFORM_LABELS[g.platform] ?? g.platform}
                  </span>
                  <span className="ban-row-title">{g.title}</span>
                  <span className="ban-row-count">
                    {g.earned}/{g.total}
                  </span>
                </button>
              ))}
              {query.trim() && searchResults.length === 0 && (
                <p className="ban-empty">No games match &ldquo;{query.trim()}&rdquo;.</p>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="ban-head">
              <h2>Duplicate games</h2>
              <span className="ban-count">{groups.length} groups</span>
              <button
                className="ban-row-toggle"
                onClick={() => {
                  setLinking(true);
                  setStatus(null);
                }}
              >
                Link games…
              </button>
              <button className="ban-close" onClick={onClose} aria-label="Close">
                ×
              </button>
            </div>

            {status && <p className="ban-empty" role="status">{status}</p>}

            <div className="ban-rows">
              {loading && <p className="ban-empty">Loading...</p>}
              {!loading && groups.length === 0 && (
                <p className="ban-empty">No duplicate groups right now.</p>
              )}
              {!loading &&
                groups.map((group) => (
                  <div key={group[0].dupeKey} className="ban-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                    <div className="ban-row" style={{ padding: 0 }}>
                      <span className="ban-row-title" style={{ marginBottom: '0.25rem' }}>{group[0].title}</span>
                      <button
                        className="ban-row-toggle"
                        onClick={() => {
                          // Merging with any current member joins the whole
                          // group transitively (union-find), so the top
                          // scorer is just a convenient anchor to merge into.
                          setPickedA(group[0]);
                          setLinking(true);
                          setStatus(null);
                        }}
                      >
                        + Add copy
                      </button>
                    </div>
                    {group.map((member, i) => (
                      <div key={shardKey(member.platform, member.id)} className="ban-row" style={{ padding: '0.25rem 0' }}>
                        <span
                          className="ban-row-platform"
                          style={{ color: ACHIEVEMENT_PLATFORM_COLORS_LIGHT[member.platform] }}
                        >
                          {PLATFORM_LABELS[member.platform] ?? member.platform}
                        </span>
                        <span className="ban-row-count">
                          {member.earned}/{member.total} &middot; {Math.round(member.score).toLocaleString()} pts
                          {i === 0 ? ' (keeps)' : ''}
                        </span>
                        <button className="ban-row-toggle" onClick={() => void splitMember(group, member)}>
                          Split
                        </button>
                      </div>
                    ))}
                  </div>
                ))}

              {(links.merges.length > 0 || links.splits.length > 0) && (
                <>
                  <p className="ban-row-title" style={{ marginTop: '1rem' }}>Manual links</p>
                  {links.merges.map((pair) => (
                    <div className="ban-row" key={`merge-${pair.join('/')}`}>
                      <span className="marks-status marks-status--earned">Merge</span>
                      <span className="ban-row-title">
                        {titleByKey.get(pair[0]) ?? pair[0]} + {titleByKey.get(pair[1]) ?? pair[1]}
                      </span>
                      <button className="ban-row-toggle" onClick={() => void removeLink(pair, 'merges')}>
                        Undo
                      </button>
                    </div>
                  ))}
                  {links.splits.map((pair) => (
                    <div className="ban-row" key={`split-${pair.join('/')}`}>
                      <span className="marks-status marks-status--skipped">Split</span>
                      <span className="ban-row-title">
                        {titleByKey.get(pair[0]) ?? pair[0]} / {titleByKey.get(pair[1]) ?? pair[1]}
                      </span>
                      <button className="ban-row-toggle" onClick={() => void removeLink(pair, 'splits')}>
                        Undo
                      </button>
                    </div>
                  ))}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
