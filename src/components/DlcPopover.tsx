import { useCallback, useRef, useState } from 'react';
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
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setClosing(true);
    panelRef.current?.addEventListener(
      'animationend',
      () => {
        setClosing(false);
        setVisible(false);
      },
      { once: true },
    );
  }, []);

  const showOverlay = visible || closing;

  return (
    <>
      {!showOverlay && (
        <button
          className="dlc-badge"
          onClick={(e) => {
            e.stopPropagation();
            setVisible(true);
          }}
        >
          {badgeText(extras)}
        </button>
      )}
      {showOverlay && (
        <>
          <div className="dlc-popover-backdrop" onClick={close} />
          <div
            ref={panelRef}
            className={`dlc-popover${closing ? ' closing' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              close();
            }}
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
    </>
  );
}
