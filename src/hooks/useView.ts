import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { getInitialView, rememberView, viewFromLocation } from '../types/view';
import type { View } from '../types/view';

/**
 * Owns which view is on screen, and keeps it in the address bar so a
 * refresh lands where you were rather than back on the list.
 *
 * `inTransition` blanks the outgoing view for a frame. The swap is done
 * inside flushSync so React commits the blank before the scroll below
 * runs — otherwise the browser restores the old view's scroll position
 * against the new view's content.
 */
export function useView(): {
  view: View;
  changeView: (next: View) => void;
  inTransition: boolean;
} {
  const [view, setView] = useState<View>(getInitialView);
  const [inTransition, setInTransition] = useState(false);

  // The visual half of a view change, with no history in it. Both a nav
  // and a Back go through here; only a nav also writes an entry.
  const applyView = useCallback((next: View) => {
    flushSync(() => {
      setInTransition(true);
      setView(next);
    });
    requestAnimationFrame(() => {
      window.scrollTo(0, 0);
      setInTransition(false);
    });
  }, []);

  const changeView = useCallback(
    (next: View) => {
      rememberView(next);
      applyView(next);
    },
    [applyView],
  );

  // In dev the opening view can come from storage while the URL still
  // says nothing, which would leave the first history entry describing a
  // page that isn't on screen. Correct it in place, once.
  const synced = useRef(false);
  useEffect(() => {
    if (synced.current) return;
    synced.current = true;
    rememberView(view, { replace: true });
    // Deliberately mount-only: this is about the entry the page opened
    // on, and every later change writes its own entry through changeView.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Each nav pushed an entry, so Back and Forward now move between views.
  // The URL alone decides where they land — see viewFromLocation.
  useEffect(() => {
    const onPopState = () => applyView(viewFromLocation());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [applyView]);

  return { view, changeView, inTransition };
}
