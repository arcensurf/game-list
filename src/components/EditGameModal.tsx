import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AchievementData, ExtraContent, GameWithCover, PlatformLibraryEntry } from '../types/game';
import { buildTitleIndex, normalizeTitle, PLATFORM_FAMILIES } from '../utils/achievementMatch';
import PlatformPicker from './PlatformPicker';

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
  const [activeTab, setActiveTab] = useState<'game' | 'tracking'>('game');
  const [title, setTitle] = useState(game.title);
  const [platforms, setPlatforms] = useState<string[]>(game.platforms);
  const initialExtras = serializeExtras(game.extras);
  const [extras, setExtras] = useState(initialExtras);
  const [extrasOpen, setExtrasOpen] = useState(initialExtras.length > 0);
  const [isGameOfGames, setIsGameOfGames] = useState(!!game.gameOfGames);
  const [gameOfGamesTagline, setGameOfGamesTagline] = useState(game.gameOfGames || '');
  const [steamAppId, setSteamAppId] = useState(game.steamAppId?.toString() || '');
  const [psnNpCommId, setPsnNpCommId] = useState(game.psnNpCommId || '');
  const [xboxTitleId, setXboxTitleId] = useState(game.xboxTitleId || '');
  const [ffxivLodestoneId, setFfxivLodestoneId] = useState(game.ffxivLodestoneId || '');
  const [data, setData] = useState<AchievementData | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isBacklog = game.status === 'backlog';

  const index = useMemo(() => buildTitleIndex(data), [data]);

  const findIdForEntry = (
    map: Record<string, PlatformLibraryEntry> | undefined,
    entry: PlatformLibraryEntry,
  ): string | null => {
    if (!map) return null;
    for (const [id, e] of Object.entries(map)) if (e === entry) return id;
    return null;
  };

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

  const showSteam = platforms.some((p) => PLATFORM_FAMILIES.steam.has(p));
  const showPsn = platforms.some((p) => PLATFORM_FAMILIES.psn.has(p));
  const showXbox = platforms.some((p) => PLATFORM_FAMILIES.xbox.has(p));
  const showFfxiv = /ffxiv|final fantasy xiv/i.test(title);
  // Badge counts only IDs whose section is actually rendered, so the
  // number always matches what the user sees inside the tab.
  const trackingCount =
    (showSteam && steamAppId ? 1 : 0) +
    (showPsn && psnNpCommId ? 1 : 0) +
    (showXbox && xboxTitleId ? 1 : 0) +
    (showFfxiv && ffxivLodestoneId ? 1 : 0);

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setSaving(true);
    const res = await fetch('/api/delete-game', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: game.title }),
    });
    if (res.ok) {
      window.dispatchEvent(new Event('games-updated'));
      onClose();
    } else {
      const data = await res.json();
      setError(data.error || 'Failed to delete');
      setSaving(false);
      setConfirmDelete(false);
    }
  };

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
        subtitle: game.subtitle ?? null,
        platforms,
        extras: parseExtras(extras),
        gameOfGames: isGameOfGames ? gameOfGamesTagline.trim() || null : null,
        steamAppId: steamAppId ? Number(steamAppId) : null,
        psnNpCommId: psnNpCommId.trim() || null,
        xboxTitleId: xboxTitleId.trim() || null,
        ffxivLodestoneId: ffxivLodestoneId.trim() || null,
      }),
    });

    if (res.ok) {
      window.dispatchEvent(new Event('games-updated'));
      onClose();
    } else {
      const data = await res.json();
      setError(data.error || 'Failed to save');
      setSaving(false);
    }
  };

  return createPortal(
    <div className="add-game-modal-backdrop" onClick={onClose}>
      <form
        className="add-game-form add-game-form--tabbed"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="edit-modal-header">
          <h2>Edit Game</h2>
          <div className="edit-modal-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'game'}
              className={`edit-tab${activeTab === 'game' ? ' edit-tab--active' : ''}`}
              onClick={() => setActiveTab('game')}
            >
              Game
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'tracking'}
              className={`edit-tab${activeTab === 'tracking' ? ' edit-tab--active' : ''}`}
              onClick={() => setActiveTab('tracking')}
            >
              Tracking
              {trackingCount > 0 && (
                <span className="edit-tab-badge">{trackingCount}</span>
              )}
            </button>
          </div>
        </div>
        {error && <p className="add-game-error">{error}</p>}

        {activeTab === 'game' && (
          <>
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
            <PlatformPicker selected={platforms} onChange={setPlatforms} />
            {!isBacklog && (
              <div className="form-field">
                <button
                  type="button"
                  className="extras-toggle"
                  onClick={() => setExtrasOpen((v) => !v)}
                  aria-expanded={extrasOpen}
                >
                  <span className={`extras-caret${extrasOpen ? ' extras-caret--open' : ''}`}>›</span>
                  Extras
                  <span className="extras-toggle-summary">
                    {extras.trim()
                      ? `${parseExtras(extras).length} group${parseExtras(extras).length === 1 ? '' : 's'}`
                      : 'none'}
                  </span>
                </button>
                {extrasOpen && (
                  <textarea
                    value={extras}
                    onChange={(e) => setExtras(e.target.value)}
                    rows={3}
                    placeholder={"DLC: Expansion 1, Expansion 2\nPaths: Route A, Route B"}
                  />
                )}
              </div>
            )}
            {!isBacklog && (
              <div className={`gog-row${isGameOfGames ? ' gog-row--active' : ''}`}>
                <label className="gog-toggle">
                  <input
                    type="checkbox"
                    className="gog-checkbox-hidden"
                    checked={isGameOfGames}
                    onChange={(e) => setIsGameOfGames(e.target.checked)}
                  />
                  <span className="gog-star" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="14" height="14">
                      <path
                        d="M12 2l2.92 6.91L22 9.97l-5.5 4.92L18.18 22 12 18.27 5.82 22l1.68-7.11L2 9.97l7.08-1.06L12 2z"
                        fill="currentColor"
                      />
                    </svg>
                  </span>
                  <span className="gog-label">Game of Games</span>
                </label>
                {isGameOfGames && (
                  <input
                    type="text"
                    className="gog-tagline"
                    value={gameOfGamesTagline}
                    onChange={(e) => setGameOfGamesTagline(e.target.value)}
                    placeholder='Tagline — e.g. The "memorable quote" game'
                  />
                )}
              </div>
            )}
          </>
        )}

        {activeTab === 'tracking' && (
          <div className="tracking-tab">
            {!showSteam && !showPsn && !showXbox && !showFfxiv && (
              <p className="tracking-empty">
                No tracking applies. Add a Steam, PlayStation, or Xbox platform to surface ID overrides, or include "FFXIV" in the title for a Lodestone field.
              </p>
            )}
            {showSteam && (
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
            {showPsn && (
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
            {showXbox && (
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
            {showFfxiv && (
              <label>
                FFXIV Lodestone ID (override)
                <input
                  type="text"
                  value={ffxivLodestoneId}
                  onChange={(e) => setFfxivLodestoneId(e.target.value)}
                  placeholder="e.g. 21418122"
                />
              </label>
            )}
          </div>
        )}

        <div className="add-game-actions">
          <button
            type="button"
            className="delete-btn"
            onClick={handleDelete}
            disabled={saving}
          >
            {confirmDelete ? 'Confirm Delete' : 'Delete'}
          </button>
          <div className="add-game-actions-right">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </form>
    </div>,
    document.body,
  );
}
