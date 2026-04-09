import { useState } from 'react';
import type { ExtraContent } from '../types/game';

function badgeText(extras: ExtraContent[]): string {
  const totalItems = extras.reduce((n, g) => n + g.items.length, 0);
  if (extras.length === 1) {
    return `+${totalItems} ${extras[0].label}`;
  }
  return `+${totalItems} Extras`;
}

export default function ExtrasPopover({
  extras,
}: {
  extras: ExtraContent[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="dlc-popover-wrapper">
      <button
        className="dlc-badge"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
      >
        {badgeText(extras)}
      </button>
      {open && (
        <>
          <div className="dlc-popover-backdrop" onClick={() => setOpen(false)} />
          <div
            className="dlc-popover"
            onClick={(e) => e.stopPropagation()}
          >
            {extras.map((group) => (
              <div key={group.label} className="extras-group">
                <h4 className="extras-group-label">{group.label}</h4>
                <ul>
                  {group.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
