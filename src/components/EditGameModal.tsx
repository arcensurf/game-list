import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { ExtraContent, GameWithCover } from '../types/game';
import PlatformPicker from './PlatformPicker';

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
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

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
          </label>
        )}
        {platforms.some((p) => ['Xbox 360'].includes(p)) && (
          <label>
            Xbox Title ID (override)
            <input
              type="text"
              value={xboxTitleId}
              onChange={(e) => setXboxTitleId(e.target.value)}
              placeholder="Xbox title ID"
            />
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
