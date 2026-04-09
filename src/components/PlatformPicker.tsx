import { useState } from 'react';
import { PLATFORM_COLORS } from './PlatformBadge';

const KNOWN_PLATFORMS = Object.keys(PLATFORM_COLORS);

export default function PlatformPicker({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (platforms: string[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newPlatform, setNewPlatform] = useState('');

  const toggle = (platform: string) => {
    if (selected.includes(platform)) {
      onChange(selected.filter((p) => p !== platform));
    } else {
      onChange([...selected, platform]);
    }
  };

  const handleAdd = () => {
    const trimmed = newPlatform.trim();
    if (trimmed && !selected.includes(trimmed)) {
      onChange([...selected, trimmed]);
    }
    setNewPlatform('');
    setAdding(false);
  };

  return (
    <div className="platform-picker">
      <div className="platform-picker-chips">
        {KNOWN_PLATFORMS.map((p) => (
          <button
            key={p}
            type="button"
            className={`platform-chip ${selected.includes(p) ? 'selected' : ''}`}
            style={
              selected.includes(p)
                ? { backgroundColor: PLATFORM_COLORS[p], borderColor: PLATFORM_COLORS[p] }
                : undefined
            }
            onClick={() => toggle(p)}
          >
            {p}
          </button>
        ))}
        {/* Show any custom platforms not in the known list */}
        {selected
          .filter((p) => !KNOWN_PLATFORMS.includes(p))
          .map((p) => (
            <button
              key={p}
              type="button"
              className="platform-chip selected"
              onClick={() => toggle(p)}
            >
              {p}
            </button>
          ))}
      </div>
      {adding ? (
        <div className="platform-add-row">
          <input
            type="text"
            value={newPlatform}
            onChange={(e) => setNewPlatform(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); handleAdd(); }
              if (e.key === 'Escape') setAdding(false);
            }}
            placeholder="Platform name"
            autoFocus
          />
          <button type="button" onClick={handleAdd}>Add</button>
          <button type="button" onClick={() => setAdding(false)}>Cancel</button>
        </div>
      ) : (
        <button type="button" className="platform-add-btn" onClick={() => setAdding(true)}>
          + New Platform
        </button>
      )}
    </div>
  );
}
