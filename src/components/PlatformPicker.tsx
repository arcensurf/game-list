import { useMemo, useRef, useState } from 'react';
import { PLATFORM_COLORS } from '../utils/platformColors';

const KNOWN_PLATFORMS = Object.keys(PLATFORM_COLORS);

export default function PlatformPicker({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (platforms: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Suggestions only appear once the user has typed something — an
  // unsolicited dropdown on focus reads as visual noise.
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return KNOWN_PLATFORMS.filter(
      (p) => !selected.includes(p) && p.toLowerCase().includes(q),
    ).slice(0, 8);
  }, [query, selected]);

  const isKnown = (p: string) => Object.prototype.hasOwnProperty.call(PLATFORM_COLORS, p);
  const customSelected = selected.filter((p) => !isKnown(p));

  const add = (platform: string) => {
    const trimmed = platform.trim();
    if (!trimmed || selected.includes(trimmed)) return;
    onChange([...selected, trimmed]);
    setQuery('');
    setHighlight(0);
    inputRef.current?.focus();
  };

  const remove = (platform: string) => {
    onChange(selected.filter((p) => p !== platform));
  };

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && matches[highlight]) add(matches[highlight]);
      else if (query.trim()) add(query);
    } else if (e.key === 'Escape') {
      setOpen(false);
    } else if (e.key === 'Backspace' && !query && selected.length) {
      remove(selected[selected.length - 1]);
    }
  };

  const showSuggestions = open && matches.length > 0;

  return (
    <div className="platform-picker">
      <div className="platform-picker-header">
        <span className="form-field-label">Platforms</span>
        {selected.length > 0 && (
          <div className="platform-pills-list">
            {selected.map((p) => (
              <span
                key={p}
                className={`platform-pill${isKnown(p) ? '' : ' platform-pill--custom'}`}
                style={isKnown(p) ? { background: PLATFORM_COLORS[p] } : undefined}
              >
                {p}
                <button
                  type="button"
                  className="platform-pill-remove"
                  onClick={() => remove(p)}
                  aria-label={`Remove ${p}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="platform-picker-search">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setHighlight(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={handleKey}
          placeholder="Type to add a platform…"
          className="platform-picker-input"
        />
        {showSuggestions && (
          <ul className="platform-suggestions">
            {matches.map((p, i) => (
              <li
                key={p}
                className={i === highlight ? 'highlighted' : ''}
                onMouseDown={(e) => {
                  e.preventDefault();
                  add(p);
                }}
                onMouseEnter={() => setHighlight(i)}
              >
                <span
                  className="platform-suggestion-swatch"
                  style={{ background: PLATFORM_COLORS[p] }}
                  aria-hidden="true"
                />
                {p}
              </li>
            ))}
          </ul>
        )}
      </div>
      {customSelected.length > 0 && (
        <p className="platform-picker-warning">
          Custom (no badge color): {customSelected.join(', ')}
        </p>
      )}
    </div>
  );
}
