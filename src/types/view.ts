export type View = 'list' | 'backlog' | 'stats' | 'picker' | 'leaderboard';

// The trophy picker writes through the dev API, so it has no meaning on
// the deployed site — it only joins the nav and the swipe order locally.
// The leaderboard is read-only and derived from already-public data, so
// unlike the picker it ships everywhere.
export const VIEW_ORDER: View[] = import.meta.env.DEV
  ? ['list', 'backlog', 'leaderboard', 'stats', 'picker']
  : ['list', 'backlog', 'leaderboard', 'stats'];

const VIEW_KEY = 'game-list:view';

// OBS points a browser source straight at ?stage=1 so the capture comes
// back up on the picker after a restart, with no clicking required.
//
// Otherwise the last view is restored, but only in dev: a stray reload
// while working shouldn't dump you back on the full list, and on the
// picker that also means losing the achievement on screen. The deployed
// site always opens on the list — visitors get the front door, not
// wherever someone happened to be last.
export function getInitialView(): View {
  if (!import.meta.env.DEV) return 'list';
  if (new URLSearchParams(window.location.search).get('stage') === '1') return 'picker';
  try {
    const saved = localStorage.getItem(VIEW_KEY) as View | null;
    if (saved && VIEW_ORDER.includes(saved)) return saved;
  } catch {
    // Private windows and blocked site data both throw on access.
  }
  return 'list';
}

export function rememberView(view: View): void {
  if (!import.meta.env.DEV) return;
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    // Not worth interrupting anyone over.
  }
}
