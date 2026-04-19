import { useEffect, useRef, useState } from 'react';
import type { ExtraContent } from '../types/game';

export default function ExtrasList({ extras }: { extras: ExtraContent[] }) {
  const [scrolling, setScrolling] = useState(false);
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  // Detect whether the content overflows the soft-capped viewport.
  // Checks the inner's scrollHeight rather than the outer's so the
  // measurement stays accurate once `scrolling` flips on and the
  // layer wrappers come into play.
  useEffect(() => {
    const inner = innerRef.current;
    const outer = outerRef.current;
    if (!inner || !outer) return;
    const check = () => {
      setScrolling(inner.scrollHeight > outer.clientHeight + 1);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(inner);
    ro.observe(outer);
    return () => ro.disconnect();
  }, [extras]);

  const items = (
    <>
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
    </>
  );

  return (
    <div
      ref={outerRef}
      className={`extras-list${scrolling ? ' extras-list--scrolling' : ''}`}
    >
      <div className="extras-list-layer extras-list-layer--primary">
        <div ref={innerRef} className="extras-list-inner">
          {items}
        </div>
      </div>
      {scrolling && (
        <>
          <div
            className="extras-list-layer extras-list-layer--secondary"
            aria-hidden
          >
            <div className="extras-list-inner">{items}</div>
          </div>
          <span className="extras-scanline" aria-hidden />
        </>
      )}
    </div>
  );
}
