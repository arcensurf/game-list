import { useCallback, useRef } from 'react';
import { VIEW_ORDER } from '../types/view';
import type { View } from '../types/view';

export function useViewSwipe(
  view: View,
  changeView: (next: View) => void,
): {
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchEnd: (e: React.TouchEvent) => void;
} {
  const swipeStart = useRef<{ x: number; y: number; t: number } | null>(null);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest('.alphabet-nav')) {
      swipeStart.current = null;
      return;
    }
    const t = e.touches[0];
    swipeStart.current = { x: t.clientX, y: t.clientY, t: Date.now() };
  }, []);

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const start = swipeStart.current;
      swipeStart.current = null;
      if (!start) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - start.x;
      const dy = Math.abs(t.clientY - start.y);
      const dt = Date.now() - start.t;
      if (Math.abs(dx) < 60 || Math.abs(dx) < dy * 1.4 || dt > 500) return;
      const idx = VIEW_ORDER.indexOf(view);
      if (dx < 0 && idx < VIEW_ORDER.length - 1) {
        changeView(VIEW_ORDER[idx + 1]);
      } else if (dx > 0 && idx > 0) {
        changeView(VIEW_ORDER[idx - 1]);
      }
    },
    [view, changeView],
  );

  return { onTouchStart, onTouchEnd };
}
