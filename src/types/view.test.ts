import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getInitialView, rememberView, viewFromLocation } from './view';

const VIEW_KEY = 'game-list:view';

/** jsdom keeps a real history, so navigate by replacing the entry. */
function at(search: string): void {
  window.history.replaceState(null, '', `/game-list/${search}`);
}

beforeEach(() => {
  localStorage.clear();
  at('');
});

// One test runs as production; without this the stub leaks into the rest.
afterEach(() => vi.unstubAllEnvs());

describe('viewFromLocation', () => {
  it('reads the view out of the query string', () => {
    at('?view=leaderboard');
    expect(viewFromLocation()).toBe('leaderboard');
  });

  it('falls back to the list when there is no view', () => {
    expect(viewFromLocation()).toBe('list');
  });

  it('ignores a value that is not a view', () => {
    at('?view=highscores');
    expect(viewFromLocation()).toBe('list');
  });

  it('still honours the OBS stage parameter', () => {
    at('?stage=1');
    expect(viewFromLocation()).toBe('picker');
  });

  // The one path that names a view without checking VIEW_ORDER, so it has
  // to be gated the same way the picker itself is.
  it('ignores the stage parameter off dev, where the picker does not ship', () => {
    vi.stubEnv('DEV', false);
    at('?stage=1');
    expect(viewFromLocation()).toBe('list');
  });

  // What Back means: an entry with no view is the list, whatever storage
  // happens to remember. getInitialView is the one that may consult it.
  it('does not consult storage', () => {
    localStorage.setItem(VIEW_KEY, 'leaderboard');
    expect(viewFromLocation()).toBe('list');
  });
});

describe('getInitialView', () => {
  it('opens on the view the URL asks for', () => {
    at('?view=stats');
    expect(getInitialView()).toBe('stats');
  });

  it('lets an explicit ?view=list beat a stored view', () => {
    localStorage.setItem(VIEW_KEY, 'leaderboard');
    at('?view=list');
    expect(getInitialView()).toBe('list');
  });

  it('falls back to a stored view when the URL says nothing', () => {
    localStorage.setItem(VIEW_KEY, 'backlog');
    expect(getInitialView()).toBe('backlog');
  });

  it('ignores a stored value that is not a view', () => {
    localStorage.setItem(VIEW_KEY, 'highscores');
    expect(getInitialView()).toBe('list');
  });
});

describe('rememberView', () => {
  it('writes the view to the query string', () => {
    rememberView('leaderboard');
    expect(window.location.search).toBe('?view=leaderboard');
  });

  // The front door stays a bare URL, so the list reads as no parameter.
  it('drops the parameter for the list', () => {
    at('?view=leaderboard');
    rememberView('list');
    expect(window.location.search).toBe('');
  });

  it('leaves the rest of the query string alone', () => {
    at('?stage=1');
    rememberView('backlog');
    expect(new URLSearchParams(window.location.search).get('stage')).toBe('1');
    expect(new URLSearchParams(window.location.search).get('view')).toBe('backlog');
  });

  it('pushes an entry so Back returns to the previous view', () => {
    const before = window.history.length;
    rememberView('stats');
    expect(window.history.length).toBe(before + 1);
  });

  it('replaces rather than pushes when asked, so Back skips the mount sync', () => {
    const before = window.history.length;
    rememberView('stats', { replace: true });
    expect(window.history.length).toBe(before);
    expect(window.location.search).toBe('?view=stats');
  });

  it('writes no entry when the URL already says that view', () => {
    at('?view=stats');
    const before = window.history.length;
    rememberView('stats');
    expect(window.history.length).toBe(before);
  });
});
