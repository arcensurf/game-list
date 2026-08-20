import { useCallback, useEffect, useState } from 'react';

const BODY_CLASS = 'stage-only';

/**
 * Stage mode strips the page down to the trophy card alone — no
 * masthead, nav, or controls.
 *
 * The point is OBS: a browser source pointed at ?stage=1 shows exactly
 * the card and nothing else, so the capture needs no cropping and won't
 * drift if the surrounding layout changes later. Driving the picker
 * happens from a normal browser window on the same dev server.
 */
export function useStageMode(): { stageOnly: boolean; toggleStage: () => void } {
  const [stageOnly, setStageOnly] = useState(
    () => new URLSearchParams(window.location.search).get('stage') === '1',
  );

  useEffect(() => {
    document.body.classList.toggle(BODY_CLASS, stageOnly);
    return () => document.body.classList.remove(BODY_CLASS);
  }, [stageOnly]);

  // Escape is the way back out — in stage mode the toggle button is one
  // of the things that gets hidden.
  useEffect(() => {
    if (!stageOnly) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setStageOnly(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stageOnly]);

  const toggleStage = useCallback(() => setStageOnly((v) => !v), []);

  return { stageOnly, toggleStage };
}
