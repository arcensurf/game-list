import { useEffect } from 'react';

// One card's worth of the lookups the update loop used to redo every frame.
// `ref` is what we measure (the cover, so taller Game of Games cards don't
// compute a lower center than their row-mates); `target` is what the value
// lands on (the wrapper, so siblings like .achievement-slot inherit it).
// Both fall back to the card itself — flat views (gog/perfect) render cards
// without a .card-wrapper, and a card can be measured before its cover exists.
type TrackedCard = {
  card: HTMLElement;
  ref: HTMLElement;
  target: HTMLElement;
};

// Updates each .game-card's --card-dim based on distance from viewport
// center (0 = fully lit, 1 = fully dim). CSS derives brightness,
// saturation, and grain-overlay opacity from that single value.
// When `enabled` is false, clears the inline styles so CSS can take over
// and paint every card at full brightness.
export function useCardSpotlight(enabled: boolean = true) {
  useEffect(() => {
    if (!enabled) {
      document.querySelectorAll<HTMLElement>('.game-card').forEach((c) => {
        const wrapper = c.closest('.card-wrapper') as HTMLElement | null;
        (wrapper ?? c).style.removeProperty('--card-dim');
      });
      return;
    }
    // Vertical position of the spotlight center, as a fraction of viewport
    // height. Eyes naturally look toward the upper third, so biasing the
    // "live" band upward leaves a peek of the row behind it visible.
    const CENTER_Y = 0.35;
    // Fully-lit band around the center, as a fraction of viewport height.
    const PLATEAU = 0.2;
    // Width of the transition band between lit and dim. Small = sharper switch.
    const FALLOFF = 0.06;

    let rafId: number | null = null;
    let observer: MutationObserver | null = null;
    let tracked: TrackedCard[] = [];
    let cardsDirty = true;

    // Re-resolved only when the card set actually changes, not per frame.
    // At 224 cards, the querySelector + closest this does were ~450 tree
    // walks per scroll frame spent re-deriving an answer that almost never
    // changes.
    const collect = () => {
      const cards = document.querySelectorAll<HTMLElement>('.game-card');
      tracked = Array.from(cards, (card) => {
        const cover = card.querySelector<HTMLElement>('.game-card-cover');
        const wrapper = card.closest<HTMLElement>('.card-wrapper');
        return { card, ref: cover ?? card, target: wrapper ?? card };
      });
      cardsDirty = false;
    };

    const update = () => {
      rafId = null;
      if (cardsDirty) collect();

      const viewportH = window.innerHeight;
      const center = viewportH * CENTER_Y;
      const plateauPx = viewportH * PLATEAU;
      const falloffPx = viewportH * FALLOFF;

      // Two passes, deliberately. Writing --card-dim dirties style, so the
      // next card's getBoundingClientRect forced the browser to flush style
      // and layout before it could answer — with reads and writes
      // interleaved, every card after the first paid for a synchronous
      // recalc, 224 times a scroll frame. Collecting all the reads first
      // costs one layout for the whole pass.
      const writes: Array<[HTMLElement, string]> = [];

      for (const { card, ref, target } of tracked) {
        const rect = card.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top > viewportH) continue; // off-screen, skip
        const refRect = ref === card ? rect : ref.getBoundingClientRect();
        const refCenter = refRect.top + refRect.height / 2;
        const dist = Math.abs(refCenter - center);
        let t: number; // 0 = fully lit, 1 = fully dim
        if (dist <= plateauPx) {
          t = 0;
        } else if (dist >= plateauPx + falloffPx) {
          t = 1;
        } else {
          t = (dist - plateauPx) / falloffPx;
        }
        writes.push([target, t.toFixed(3)]);
      }

      for (const [el, value] of writes) {
        el.style.setProperty('--card-dim', value);
      }
    };

    const schedule = () => {
      if (rafId === null) rafId = requestAnimationFrame(update);
    };

    schedule();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });

    // Re-run when cards are added/removed (filters, data load) — but only
    // then. Watching every childList mutation meant unrelated renders kicked
    // off a full recompute: opening a card's HUD mounts its extras list, and
    // that alone re-measured all 224 cards.
    const touchesCards = (nodes: NodeList) => {
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (!(node instanceof HTMLElement)) continue;
        // Cards arrive wrapped (.card-wrapper / letter section), so check the
        // subtree as well as the node itself. Works for removals too — a
        // detached subtree keeps its structure.
        if (node.classList.contains('game-card') || node.querySelector('.game-card')) {
          return true;
        }
      }
      return false;
    };

    observer = new MutationObserver((records) => {
      for (const record of records) {
        if (touchesCards(record.addedNodes) || touchesCards(record.removedNodes)) {
          cardsDirty = true;
          schedule();
          return;
        }
      }
    });
    // Scoped to <main>, which App renders unconditionally and swaps the view
    // inside of, so it's stable across view changes. Falls back to body in
    // case that ever stops being true.
    observer.observe(document.querySelector('main') ?? document.body, {
      childList: true,
      subtree: true,
    });

    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      observer?.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [enabled]);
}
