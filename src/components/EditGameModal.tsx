import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AchievementData, ExtraContent, GameWithCover, PlatformLibraryEntry } from '../types/game';
import { buildTitleIndex, normalizeTitle } from '../utils/achievementMatch';
import PlatformPicker from './PlatformPicker';

// The modal reads achievements.json — the same runtime source of truth
// the render path uses — so pre-fill / hint lookups stay in lockstep
// with what's actually being displayed. achievements.json is keyed by
// platform ID, which is exactly what the override fields store, so
// lookup by ID is a direct map access. Title lookup goes through the
// shared buildTitleIndex + normalizeTitle helpers so there's one
// matching implementation shared with useGames.

const DATA_BASE = import.meta.env.DEV
  ? import.meta.env.BASE_URL
  : 'https://raw.githubusercontent.com/arcensurf/game-list/data/public/';

function serializeExtras(extras: ExtraContent[]): string {
  return extras
    .map((g) => `${g.label}: ${g.items.join(', ')}`)
    .join('\n');
}

function parseExtras(text: string): ExtraContent[] {
  if (!text.trim()) return [];
  return text
    .split('\n')
    .map((line) => {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) {
        return { label: 'DLC', items: line.split(',').map((s) => s.trim()).filter(Boolean) };
      }
      const label = line.slice(0, colonIdx).trim();
      const items = line.slice(colonIdx + 1).split(',').map((s) => s.trim()).filter(Boolean);
      return { label, items };
    })
    .filter((g) => g.items.length > 0);
}

export default function EditGameModal({
  game,
  onClose,
}: {
  game: GameWithCover;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(game.title);
  const [subtitle, setSubtitle] = useState(game.subtitle || '');
  const [platforms, setPlatforms] = useState<string[]>(game.platforms);
  const [extras, setExtras] = useState(serializeExtras(game.extras));
  const [isGameOfGames, setIsGameOfGames] = useState(!!game.gameOfGames);
  const [gameOfGamesTagline, setGameOfGamesTagline] = useState(game.gameOfGames || '');
  const [steamAppId, setSteamAppId] = useState(game.steamAppId?.toString() || '');
  const [psnNpCommId, setPsnNpCommId] = useState(game.psnNpCommId || '');
  const [xboxTitleId, setXboxTitleId] = useState(game.xboxTitleId || '');
  const [data, setData] = useState<AchievementData | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Precomputed normalized-title → best-entry index. Rebuilt only when
  // data reloads, queried O(1) on every keystroke as the user edits
  // the title field. Collisions (two DiRT 3 titleIds normalizing to
  // "dirt3" — one full game, one demo) resolve to the higher-ranked
  // entry (completion % for PSN/Xbox, playtime for Steam) via the
  // shared buildTitleIndex helper.
  const index = useMemo(() => buildTitleIndex(data), [data]);

  // Helpers to recover the platform-ID of a title-matched entry.
  // buildTitleIndex returns the entry without its key, but the hint
  // text needs to show the id alongside the title. Fall back to a
  // direct scan of the raw map to find which id points at the entry
  // we matched — iteration is cheap since the map is a few hundred
  // entries and this only runs when a match is found.
  const findIdForEntry = (
    map: Record<string, PlatformLibraryEntry> | undefined,
    entry: PlatformLibraryEntry,
  ): string | null => {
    if (!map) return null;
    for (const [id, e] of Object.entries(map)) if (e === entry) return id;
    return null;
  };

  // Fetch achievements.json once on mount, and auto-fill any empty
  // override fields whose title matches. The same index drives the
  // live hints below, so pre-fill and hint pick the same entry.
  useEffect(() => {
    fetch(`${DATA_BASE}data/achievements.json`)
      .then((r) => r.json())
      .then((d: AchievementData) => {
        setData(d);
        const norm = normalizeTitle(game.title);
        const idx = buildTitleIndex(d);
        if (!game.steamAppId) {
          const m = idx.steam.get(norm);
          if (m) {
            const id = findIdForEntry(d.steam, m);
            if (id) setSteamAppId(id);
          }
        }
        if (!game.psnNpCommId) {
          const m = idx.psn.get(norm);
          if (m) {
            const id = findIdForEntry(d.psn, m);
            if (id) setPsnNpCommId(id);
          }
        }
        if (!game.xboxTitleId) {
          const m = idx.xbox.get(norm);
          if (m) {
            const id = findIdForEntry(d.xbox, m);
            if (id) setXboxTitleId(id);
          }
        }
      })
      .catch(() => { /* file may not be published yet — silently degrade */ });
    // Only runs on mount; game.* are read once for the initial pre-fill.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const normalizedTitle = normalizeTitle(title);
  const steamMatchEntry = index.steam.get(normalizedTitle) ?? null;
  const psnMatchEntry = index.psn.get(normalizedTitle) ?? null;
  const xboxMatchEntry = index.xbox.get(normalizedTitle) ?? null;
  const steamMatch = steamMatchEntry
    ? { entry: steamMatchEntry, id: findIdForEntry(data?.steam, steamMatchEntry) }
    : null;
  const psnMatch = psnMatchEntry
    ? { entry: psnMatchEntry, id: findIdForEntry(data?.psn, psnMatchEntry) }
    : null;
  const xboxMatch = xboxMatchEntry
    ? { entry: xboxMatchEntry, id: findIdForEntry(data?.xbox, xboxMatchEntry) }
    : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);

    const res = await fetch('/api/edit-game', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        originalTitle: game.title,
        title: title.trim(),
        subtitle: subtitle.trim() || null,
        platforms,
        extras: parseExtras(extras),
        gameOfGames: isGameOfGames ? gameOfGamesTagline.trim() || null : null,
        steamAppId: steamAppId ? Number(steamAppId) : null,
        psnNpCommId: psnNpCommId.trim() || null,
        xboxTitleId: xboxTitleId.trim() || null,
      }),
    });

    if (res.ok) {
      window.location.reload();
    } else {
      const data = await res.json();
      setError(data.error || 'Failed to save');
      setSaving(false);
    }
  };

  return createPortal(
    <div className="add-game-modal-backdrop" onClick={onClose}>
      <form
        className="add-game-form"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <h2>Edit Game</h2>
        {error && <p className="add-game-error">{error}</p>}
        <label>
          Title
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            autoFocus
          />
        </label>
        <label>
          Subtitle
          <input
            type="text"
            value={subtitle}
            onChange={(e) => setSubtitle(e.target.value)}
            placeholder="Story Mode, The Subspace Emissary, etc."
          />
        </label>
        <div className="form-field">
          <span className="form-field-label">Platforms</span>
          <PlatformPicker selected={platforms} onChange={setPlatforms} />
        </div>
        <label>
          Extras (one group per line: Label: item1, item2)
          <textarea
            value={extras}
            onChange={(e) => setExtras(e.target.value)}
            rows={3}
            placeholder={"DLC: Expansion 1, Expansion 2\nPaths: Route A, Route B"}
          />
        </label>
        {platforms.includes('PC') && (
          <label>
            Steam App ID (override)
            <input
              type="text"
              value={steamAppId}
              onChange={(e) => setSteamAppId(e.target.value)}
              placeholder="e.g. 400 for Portal"
            />
            {steamMatch && (
              <span className="field-hint">
                Steam library: {steamMatch.entry.title} · id {steamMatch.id}
                {(steamMatch.entry.playtimeMinutes ?? 0) >= 60 &&
                  ` · ${Math.round((steamMatch.entry.playtimeMinutes ?? 0) / 60)}h played`}
                {steamMatch.entry.total > 0 &&
                  ` · ${steamMatch.entry.earned}/${steamMatch.entry.total} achievements`}
              </span>
            )}
          </label>
        )}
        {platforms.some((p) => ['PS3', 'PS4', 'PS5', 'PS Vita', 'PSX'].includes(p)) && (
          <label>
            PSN NPCOMMID (override)
            <input
              type="text"
              value={psnNpCommId}
              onChange={(e) => setPsnNpCommId(e.target.value)}
              placeholder="e.g. NPWR01537_00"
            />
            {psnMatch && (
              <span className="field-hint">
                PSN library: {psnMatch.entry.title} · {psnMatch.id} ·{' '}
                {psnMatch.entry.earned}/{psnMatch.entry.total} trophies
              </span>
            )}
          </label>
        )}
        {platforms.some((p) => ['Xbox 360', 'Xbox One', 'Xbox Series X|S', 'Xbox Series X', 'Xbox Series S'].includes(p)) && (
          <label>
            Xbox Title ID (override)
            <input
              type="text"
              value={xboxTitleId}
              onChange={(e) => setXboxTitleId(e.target.value)}
              placeholder="Xbox title ID"
            />
            {xboxMatch && (
              <span className="field-hint">
                Xbox library: {xboxMatch.entry.title} · {xboxMatch.id} ·{' '}
                {xboxMatch.entry.earned}/{xboxMatch.entry.total} achievements
              </span>
            )}
          </label>
        )}
        <label className="toggle-label">
          <input
            type="checkbox"
            checked={isGameOfGames}
            onChange={(e) => setIsGameOfGames(e.target.checked)}
          />
          Game of Games
        </label>
        {isGameOfGames && (
          <label>
            Tagline
            <input
              type="text"
              value={gameOfGamesTagline}
              onChange={(e) => setGameOfGamesTagline(e.target.value)}
              placeholder='The "memorable quote" game'
            />
          </label>
        )}
        <div className="add-game-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
