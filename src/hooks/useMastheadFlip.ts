import { useEffect, useState } from 'react';

/**
 * Returns whether the masthead should flip from the title face to the
 * letter nav. Flips when the user scrolls past 80px OR after 3s of
 * dwell time on the list view.
 */
export function useMastheadFlip(view: string): boolean {
  const [scrolled, setScrolled] = useState(false);
  const [dwelled, setDwelled] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 80);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (view !== 'list') {
      // Reset via a microtask so the setState isn't synchronous
      // within the effect body.
      const t = window.setTimeout(() => setDwelled(false), 0);
      return () => window.clearTimeout(t);
    }
    const t = window.setTimeout(() => setDwelled(true), 3000);
    return () => {
      window.clearTimeout(t);
      setDwelled(false);
    };
  }, [view]);

  return view === 'list' && (scrolled || dwelled);
}
