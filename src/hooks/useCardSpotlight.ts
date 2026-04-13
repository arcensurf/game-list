import { useEffect } from 'react';

// Updates each .game-card's --card-dim based on distance from viewport
// center (0 = fully lit, 1 = fully dim). CSS derives brightness,
// saturation, and grain-overlay opacity from that single value.
// When `enabled` is false, clears the inline styles so CSS can take over
// and paint every card at full brightness.
export function useCardSpotlight(enabled: boolean = true) {
  useEffect(() => {
    if (!enabled) {
      document.querySelectorAll<HTMLElement>('.game-card').forEach((c) => {
        c.style.removeProperty('--card-dim');
      });
      return;
    }
    // Fully-lit band around viewport center, as a fraction of viewport height.
    const PLATEAU = 0.2;
    // Width of the transition band between lit and dim. Small = sharper switch.
    const FALLOFF = 0.06;

    let rafId: number | null = null;
    let observer: MutationObserver | null = null;

    const update = () => {
      rafId = null;
      const viewportH = window.innerHeight;
      const center = viewportH / 2;
      const plateauPx = viewportH * PLATEAU;
      const falloffPx = viewportH * FALLOFF;
      const cards = document.querySelectorAll<HTMLElement>('.game-card');
      cards.forEach((card) => {
        const rect = card.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top > viewportH) return; // off-screen, skip
        // Use the cover's center rather than the card's center so
        // taller cards (Game of Games has a label) don't compute a
        // lower center than their row-mates. Fall back to card rect
        // if the cover isn't there yet.
        const cover = card.querySelector<HTMLElement>('.game-card-cover');
        const ref = cover ? cover.getBoundingClientRect() : rect;
        const refCenter = ref.top + ref.height / 2;
        const dist = Math.abs(refCenter - center);
        let t: number; // 0 = fully lit, 1 = fully dim
        if (dist <= plateauPx) {
          t = 0;
        } else if (dist >= plateauPx + falloffPx) {
          t = 1;
        } else {
          t = (dist - plateauPx) / falloffPx;
        }
        card.style.setProperty('--card-dim', t.toFixed(3));
      });
    };

    const schedule = () => {
      if (rafId === null) rafId = requestAnimationFrame(update);
    };

    schedule();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });

    // Re-run when cards are added/removed (filters, data load).
    observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      observer?.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [enabled]);
}
