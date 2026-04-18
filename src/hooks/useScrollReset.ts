import { useLayoutEffect } from 'react';

/**
 * On each view change: disable scroll-snap, scroll to the top, then
 * re-enable snap once the user scrolls. useLayoutEffect + scrollTop
 * runs before paint so the user never sees the stale scroll position.
 * Multiple retries catch browser-side scroll-clamping that happens
 * post-render when content shrinks.
 */
export function useScrollReset(view: string) {
  useLayoutEffect(() => {
    const html = document.documentElement;
    html.style.scrollSnapType = 'none';
    const scroll = () => {
      html.scrollTop = 0;
      if (document.body) document.body.scrollTop = 0;
    };
    scroll();
    const timers = [0, 16, 50, 150, 300].map((ms) =>
      window.setTimeout(scroll, ms),
    );
    const enable = () => {
      html.style.scrollSnapType = '';
    };
    const readyId = window.setTimeout(() => {
      window.addEventListener('scroll', enable, { passive: true, once: true });
    }, 400);
    return () => {
      timers.forEach((id) => window.clearTimeout(id));
      window.clearTimeout(readyId);
      html.style.scrollSnapType = '';
      window.removeEventListener('scroll', enable);
    };
  }, [view]);
}
