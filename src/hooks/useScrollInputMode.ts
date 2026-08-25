import { useEffect } from 'react';

/**
 * Flags the document when the user is scrolling with a notched mouse
 * wheel, so base.css can relax the mandatory snap to proximity.
 *
 * Mandatory snap is built for continuous input. A trackpad or a finger
 * pans in fine-grained deltas and hands the browser a momentum phase, so
 * the snap resolves once, at the end of the fling — one flick glides to
 * the next row, which is why this feels right on a Mac and an iPhone. A
 * notched wheel is the opposite: each click is its own scroll gesture
 * that ends immediately, so the snap resolves after every click. A click
 * moves ~100px against a row pitch of 300-420px, so the nearest snap
 * position is still the row you started on and the browser drags you back
 * to it. Scrolling stops feeling heavy and starts feeling stuck.
 */
export function useScrollInputMode() {
  useEffect(() => {
    const html = document.documentElement;

    // Two tells, both of which only a notched wheel produces. Firefox on
    // Windows reports whole lines instead of pixels; Chrome and Edge
    // translate one notch into exactly 100px. A trackpad's pixel deltas
    // are fine-grained and, through acceleration and momentum decay,
    // essentially never land on a clean multiple of 100.
    const isNotchedWheel = (e: WheelEvent) =>
      e.deltaMode !== 0 ||
      (Math.abs(e.deltaY) >= 100 && e.deltaY % 100 === 0);

    // Classified per event rather than latched, so a laptop that gains or
    // loses an external mouse mid-session follows along. A stray
    // misclassification costs one scroll frame in the wrong mode and the
    // next event corrects it.
    const setMode = (wheel: boolean) => {
      if (wheel) html.setAttribute('data-scroll-input', 'wheel');
      else html.removeAttribute('data-scroll-input');
    };

    const onWheel = (e: WheelEvent) => setMode(isNotchedWheel(e));
    const onTouch = () => setMode(false);

    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('touchstart', onTouch, { passive: true });

    return () => {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('touchstart', onTouch);
      html.removeAttribute('data-scroll-input');
    };
  }, []);
}
