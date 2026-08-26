import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLeaderboardFilters } from './useLeaderboardFilters';
import type { View } from '../types/view';

const HIDE_DUPES_KEY = 'game-list:leaderboard-hide-dupes';
const COMPLETIONS_ONLY_KEY = 'game-list:leaderboard-completions-only';

beforeEach(() => localStorage.clear());

describe('useLeaderboardFilters', () => {
  it('starts with both modifiers off', () => {
    const { result } = renderHook(() => useLeaderboardFilters('leaderboard'));
    expect(result.current.hideDupes).toBe(false);
    expect(result.current.completionsOnly).toBe(false);
  });

  it('toggles each modifier independently', () => {
    const { result } = renderHook(() => useLeaderboardFilters('leaderboard'));

    act(() => result.current.toggleHideDupes());
    expect(result.current.hideDupes).toBe(true);
    expect(result.current.completionsOnly).toBe(false);

    act(() => result.current.toggleCompletionsOnly());
    expect(result.current.hideDupes).toBe(true);
    expect(result.current.completionsOnly).toBe(true);

    act(() => result.current.toggleHideDupes());
    expect(result.current.hideDupes).toBe(false);
    expect(result.current.completionsOnly).toBe(true);
  });

  it('persists a toggle to localStorage', () => {
    const { result } = renderHook(() => useLeaderboardFilters('leaderboard'));
    act(() => result.current.toggleHideDupes());
    expect(localStorage.getItem(HIDE_DUPES_KEY)).toBe('1');
    act(() => result.current.toggleHideDupes());
    expect(localStorage.getItem(HIDE_DUPES_KEY)).toBe('0');
  });

  it('restores stored state on a later mount', () => {
    localStorage.setItem(HIDE_DUPES_KEY, '1');
    localStorage.setItem(COMPLETIONS_ONLY_KEY, '1');
    const { result } = renderHook(() => useLeaderboardFilters('leaderboard'));
    expect(result.current.hideDupes).toBe(true);
    expect(result.current.completionsOnly).toBe(true);
  });

  it.each<View>(['list', 'backlog', 'stats', 'picker'])(
    'reads as inactive from the %s view even when stored on',
    (view) => {
      localStorage.setItem(HIDE_DUPES_KEY, '1');
      localStorage.setItem(COMPLETIONS_ONLY_KEY, '1');
      const { result } = renderHook(() => useLeaderboardFilters(view));
      expect(result.current.hideDupes).toBe(false);
      expect(result.current.completionsOnly).toBe(false);
    },
  );

  it('keeps the stored value while away from the leaderboard', () => {
    const { result, rerender } = renderHook((view: View) => useLeaderboardFilters(view), {
      initialProps: 'leaderboard' as View,
    });
    act(() => result.current.toggleHideDupes());

    rerender('backlog');
    expect(result.current.hideDupes).toBe(false);
    expect(localStorage.getItem(HIDE_DUPES_KEY)).toBe('1');

    rerender('leaderboard');
    expect(result.current.hideDupes).toBe(true);
  });

  it('survives a private window where localStorage throws', () => {
    const boom = () => {
      throw new Error('SecurityError');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(boom);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(boom);

    const { result } = renderHook(() => useLeaderboardFilters('leaderboard'));
    expect(result.current.hideDupes).toBe(false);
    expect(() => act(() => result.current.toggleHideDupes())).not.toThrow();
    expect(result.current.hideDupes).toBe(true);
  });
});
