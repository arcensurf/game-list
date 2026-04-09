import { useState } from 'react';

export default function AddGameForm() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [platforms, setPlatforms] = useState('');
  const [dlc, setDlc] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const res = await fetch('/api/add-game', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: title.trim(),
        platforms: platforms.split(',').map((p) => p.trim()).filter(Boolean),
        dlc: dlc ? dlc.split(',').map((d) => d.trim()).filter(Boolean) : [],
      }),
    });

    if (res.ok) {
      setTitle('');
      setPlatforms('');
      setDlc('');
      setOpen(false);
    } else {
      const data = await res.json();
      setError(data.error || 'Failed to add game');
    }
  };

  if (!open) {
    return (
      <button className="add-game-btn" onClick={() => setOpen(true)}>
        + Add Game
      </button>
    );
  }

  return (
    <div className="add-game-modal-backdrop" onClick={() => setOpen(false)}>
      <form
        className="add-game-form"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <h2>Add Game</h2>
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
          Platforms (comma-separated)
          <input
            type="text"
            value={platforms}
            onChange={(e) => setPlatforms(e.target.value)}
            placeholder="PS5, Switch, PC"
            required
          />
        </label>
        <label>
          DLC (comma-separated, optional)
          <input
            type="text"
            value={dlc}
            onChange={(e) => setDlc(e.target.value)}
            placeholder="Expansion 1, DLC 2"
          />
        </label>
        <div className="add-game-actions">
          <button type="button" onClick={() => setOpen(false)}>
            Cancel
          </button>
          <button type="submit">Add</button>
        </div>
      </form>
    </div>
  );
}
