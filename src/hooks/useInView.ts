import { useEffect, useRef } from 'react';

/* A single shared IntersectionObserver that flags whichever elements are
   on screen, so looping CSS animations can be paused everywhere else.
   Two views need this now — the card grid's grain, and the leaderboard's —
   so it lives here rather than being a private detail of either.

   One instance, not one per element: this has to stay live for the whole
   page (unlike a reveal observer, which unobserves once it fires), and a
   single instance batches every target into one callback instead of
   running hundreds of them. */
let observer: IntersectionObserver | null = null;

export function getInViewObserver(): IntersectionObserver {
  if (!observer) {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const el = entry.target as HTMLElement;
          // A data attribute rather than a class, because React owns
          // className on these elements and rewrites it on re-render — a
          // class set imperatively here would be silently dropped and the
          // element would go still. Nothing in the JSX touches
          // data-in-view, so React leaves it alone.
          if (entry.isIntersecting) el.dataset.inView = '';
          else delete el.dataset.inView;
        }
      },
      // Generous margin so an element is already animating before it
      // scrolls into view rather than visibly starting up.
      { rootMargin: '200px' },
    );
  }
  return observer;
}

/** Flags the returned ref's element with data-in-view while it is on screen. */
export function useInView<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = getInViewObserver();
    obs.observe(el);
    // unobserve, not disconnect — the observer is shared, so disconnecting
    // would stop tracking everything else on the page too.
    return () => obs.unobserve(el);
  }, []);
  return ref;
}
