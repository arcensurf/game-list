import { useCallback, useState } from 'react';
import type { View } from '../types/view';

// Same front-door rule as rememberView in types/view.ts: a filtered list
// is a working state, not what a visitor should meet on arrival, so it
// only survives a reload in dev.
const GOG_KEY = 'game-list:gog-filter';

function readStored(): boolean {
  if (!import.meta.env.DEV) return false;
  try {
    return localStorage.getItem(GOG_KEY) === '1';
  } catch {
    // Private windows and blocked site data both throw on access.
    return false;
  }
}

/**
 * The Games of Games filter — a mode of the list view rather than a view
 * of its own. Takes `view` so the flag reports false everywhere else:
 * the toggle only renders on the list, but the raw state outlives a trip
 * to another view, and leaking it into the backlog's own query would
 * quietly intersect the two filters.
 */
export function useGogFilter(view: View): { gogOnly: boolean; toggleGog: () => void } {
  const [enabled, setEnabled] = useState(readStored);

  const toggleGog = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      if (import.meta.env.DEV) {
        try {
          localStorage.setItem(GOG_KEY, next ? '1' : '0');
        } catch {
          // Not worth interrupting anyone over.
        }
      }
      return next;
    });
  }, []);

  return { gogOnly: view === 'list' && enabled, toggleGog };
}
