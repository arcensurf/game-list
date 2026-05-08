import { useState } from 'react';
import EditGameModal from './EditGameModal';
import type { GameStatus, GameWithCover } from '../types/game';

export default function AddGameForm() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [createdStub, setCreatedStub] = useState<GameWithCover | null>(null);

  const submit = async (status: GameStatus) => {
    setError('');
    const trimmed = title.trim();
    if (!trimmed) {
      setError('Title required');
      return;
    }

    const res = await fetch('/api/add-game', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: trimmed,
        platforms: [],
        status,
      }),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || 'Failed to add game');
      return;
    }

    window.dispatchEvent(new Event('games-updated'));
    setCreatedStub({
      title: trimmed,
      subtitle: null,
      platforms: [],
      extras: [],
      sgdbId: null,
      coverOverride: null,
      gameOfGames: null,
      order: 0,
      status,
      coverUrl: null,
      achievements: null,
    });
    setTitle('');
    setOpen(false);
  };

  return (
    <>
      <button className="add-game-btn" onClick={() => setOpen(true)}>
        + Add Game
      </button>
      {open && (
        <div
          className="add-game-modal-backdrop"
          onClick={() => setOpen(false)}
        >
          <div
            className="add-game-form add-game-form--compact"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>Add Game</h2>
            {error && <p className="add-game-error">{error}</p>}
            <label>
              Title
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    submit('beaten');
                  }
                }}
                autoFocus
              />
            </label>
            <div className="add-game-status-actions">
              <button type="button" onClick={() => submit('backlog')}>
                Add to Backlog
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => submit('beaten')}
              >
                Add as Beaten
              </button>
            </div>
            <div className="add-game-actions">
              <button type="button" onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {createdStub && (
        <EditGameModal
          game={createdStub}
          onClose={() => setCreatedStub(null)}
        />
      )}
    </>
  );
}
