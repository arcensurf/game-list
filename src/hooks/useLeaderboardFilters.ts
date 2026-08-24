import { useCallback, useState } from 'react';
import type { View } from '../types/view';

// Two view modifiers for the leaderboard, lifted out of LeaderboardView so
// the masthead can own the controls the way it owns the Games of Games
// filter — see useGogFilter, which this deliberately mirrors. They live in
// the header rather than in a band above the list because they are settings
// you pick once, not filters you sweep through while reading.
const HIDE_DUPES_KEY = 'game-list:leaderboard-hide-dupes';
const COMPLETIONS_ONLY_KEY = 'game-list:leaderboard-completions-only';

function readStored(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    // Private windows and blocked site data both throw on access.
    return false;
  }
}

function persist(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    // Not worth interrupting anyone over.
  }
}

export interface LeaderboardFilters {
  hideDupes: boolean;
  completionsOnly: boolean;
  toggleHideDupes: () => void;
  toggleCompletionsOnly: () => void;
}

/**
 * Takes `view` for the same reason useGogFilter does: the controls only
 * render on the leaderboard, but the stored state outlives a trip to
 * another view and shouldn't be readable as active from anywhere else.
 */
export function useLeaderboardFilters(view: View): LeaderboardFilters {
  const [hideDupes, setHideDupes] = useState(() => readStored(HIDE_DUPES_KEY));
  const [completionsOnly, setCompletionsOnly] = useState(() => readStored(COMPLETIONS_ONLY_KEY));

  const toggleHideDupes = useCallback(() => {
    setHideDupes((prev) => {
      persist(HIDE_DUPES_KEY, !prev);
      return !prev;
    });
  }, []);

  const toggleCompletionsOnly = useCallback(() => {
    setCompletionsOnly((prev) => {
      persist(COMPLETIONS_ONLY_KEY, !prev);
      return !prev;
    });
  }, []);

  const active = view === 'leaderboard';
  return {
    hideDupes: active && hideDupes,
    completionsOnly: active && completionsOnly,
    toggleHideDupes,
    toggleCompletionsOnly,
  };
}
