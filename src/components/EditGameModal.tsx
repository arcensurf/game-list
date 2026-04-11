import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ExtraContent, GameWithCover } from '../types/game';
import PlatformPicker from './PlatformPicker';

// ── Platform-library lookup ──
//
// platform-libraries.json is written by scripts/fetch-achievements.mjs
// and committed to the `data` branch. We fetch it here so the modal can
// (a) auto-fill empty ID override fields with a matching library entry
// on open, and (b) show a live "matches X library" hint as the user
// edits the title. The normalizer must stay in sync with the one in
// fetch-achievements.mjs (exact-match, alphanumerics only, leading
// "the" stripped) or lookups will silently miss.

type SteamLibEntry = { id: number; title: string; playtimeMinutes: number };
type PsnLibEntry = { id: string; title: string; earned: number; total: number };
type XboxLibEntry = { id: string; title: string; earned: number; total: number };
type PlatformLibraries = {
  steam: SteamLibEntry[];
  psn: PsnLibEntry[];
  xbox: XboxLibEntry[];
};

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/[®™©]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

// Build a normalized-title → best-entry map. When multiple library
// entries collide on the same normalized title (e.g. Xbox's full-game
// DiRT 3 titleId vs a demo titleId that both normalize to "dirt3"),
// `rank` picks which to keep. Higher rank wins.
function buildBestMap<T extends { title: string }>(
  entries: T[],
  rank: (e: T) => number,
): Map<string, T> {
  const m = new Map<string, T>();
  for (const e of entries) {
    const k = normalizeTitle(e.title);
    const prev = m.get(k);
    if (!prev || rank(e) > rank(prev)) m.set(k, e);
  }
  return m;
}

const steamRank = (e: SteamLibEntry) => e.playtimeMinutes;
const psnRank = (e: PsnLibEntry) => (e.total > 0 ? e.earned / e.total : 0);
const xboxRank = (e: XboxLibEntry) => (e.total > 0 ? e.earned / e.total : 0);

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
  const [libraries, setLibraries] = useState<PlatformLibraries | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Normalized-title maps for O(1) lookup on every keystroke. Uses
  // the best-entry selection helper so a collision (two DiRT 3
  // titleIds that both normalize to "dirt3" — one full game at
  // 60/60, one demo at 0/60) picks the one the user actually played.
  const steamByTitle = useMemo(
    () => buildBestMap(libraries?.steam ?? [], steamRank),
    [libraries],
  );
  const psnByTitle = useMemo(
    () => buildBestMap(libraries?.psn ?? [], psnRank),
    [libraries],
  );
  const xboxByTitle = useMemo(
    () => buildBestMap(libraries?.xbox ?? [], xboxRank),
    [libraries],
  );

  // Fetch platform libraries once on mount, and auto-fill any empty
  // override fields whose title matches a library entry. Uses the
  // same best-entry selection as the live lookup maps above.
  useEffect(() => {
    fetch(`${DATA_BASE}data/platform-libraries.json`)
      .then((r) => r.json())
      .then((libs: PlatformLibraries) => {
        setLibraries(libs);
        const norm = normalizeTitle(game.title);
        if (!game.steamAppId) {
          const m = buildBestMap(libs.steam ?? [], steamRank).get(norm);
          if (m) setSteamAppId(String(m.id));
        }
        if (!game.psnNpCommId) {
          const m = buildBestMap(libs.psn ?? [], psnRank).get(norm);
          if (m) setPsnNpCommId(m.id);
        }
        if (!game.xboxTitleId) {
          const m = buildBestMap(libs.xbox ?? [], xboxRank).get(norm);
          if (m) setXboxTitleId(m.id);
        }
      })
      .catch(() => { /* file may not be published yet — silently degrade */ });
    // Only runs on mount; game.* are read once for the initial pre-fill.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const normalizedTitle = normalizeTitle(title);
  const steamMatch = steamByTitle.get(normalizedTitle) ?? null;
  const psnMatch = psnByTitle.get(normalizedTitle) ?? null;
  const xboxMatch = xboxByTitle.get(normalizedTitle) ?? null;

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
                Steam library: {steamMatch.title} · id {steamMatch.id}
                {steamMatch.playtimeMinutes > 0 &&
                  ` · ${Math.round(steamMatch.playtimeMinutes / 60)}h played`}
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
                PSN library: {psnMatch.title} · {psnMatch.id} ·{' '}
                {psnMatch.earned}/{psnMatch.total} trophies
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
                Xbox library: {xboxMatch.title} · {xboxMatch.id} ·{' '}
                {xboxMatch.earned}/{xboxMatch.total} achievements
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
