export type View = 'list' | 'backlog' | 'stats' | 'picker' | 'leaderboard';

// The trophy picker writes through the dev API, so it has no meaning on
// the deployed site — it only joins the nav and the swipe order locally.
// The leaderboard is read-only and derived from already-public data, so
// unlike the picker it ships everywhere.
export const VIEW_ORDER: View[] = import.meta.env.DEV
  ? ['list', 'backlog', 'leaderboard', 'stats', 'picker']
  : ['list', 'backlog', 'leaderboard', 'stats'];

const VIEW_KEY = 'game-list:view';
const VIEW_PARAM = 'view';

// Anything that isn't a view this build ships is ignored rather than
// trusted: ?view=picker on the deployed site has to fall through to the
// default, because VIEW_ORDER is also what keeps the picker's dev-API
// code out of the public bundle.
function viewFromSearch(search: string): View | null {
  const raw = new URLSearchParams(search).get(VIEW_PARAM);
  return VIEW_ORDER.some((v) => v === raw) ? (raw as View) : null;
}

/**
 * The view the current URL asks for, and nothing else — no stored
 * fallback. This is what a history entry means, so Back to an entry with
 * no `view` has to land on the list even in dev, where storage would
 * otherwise answer with whatever was open last.
 */
export function viewFromLocation(): View {
  // OBS points a browser source straight at ?stage=1 so the capture comes
  // back up on the picker after a restart, with no clicking required.
  // Dev-gated like the picker itself: this is the one path that names a
  // view without checking VIEW_ORDER, so on the deployed site it would
  // otherwise hand back a view that is deliberately not in the nav, the
  // swipe order, or the bundle.
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('stage') === '1') {
    return 'picker';
  }
  return viewFromSearch(window.location.search) ?? 'list';
}

/**
 * Where to open. The URL wins, so a refresh keeps you where you were and
 * a link to ?view=leaderboard opens on the leaderboard.
 *
 * The front-door rule survives that: it was never really "always open on
 * the list", it was "a visitor should meet the front door rather than
 * wherever someone happened to be last", and the bare URL still carries
 * no view. What changes is that the address bar now records the answer
 * instead of a browser's private storage, which is also what makes it
 * shareable.
 *
 * Storage stays as a dev-only fallback for opening a bare localhost —
 * a stray reload while working shouldn't dump you back on the full list,
 * and on the picker that also means losing the achievement on screen.
 */
export function getInitialView(): View {
  const fromUrl = viewFromLocation();
  if (fromUrl !== 'list') return fromUrl;
  if (new URLSearchParams(window.location.search).has(VIEW_PARAM)) return fromUrl;
  if (!import.meta.env.DEV) return 'list';
  try {
    const saved = localStorage.getItem(VIEW_KEY) as View | null;
    if (saved && VIEW_ORDER.includes(saved)) return saved;
  } catch {
    // Private windows and blocked site data both throw on access.
  }
  return 'list';
}

/**
 * Records a view change in the address bar, and in dev in storage too.
 *
 * `replace` is for the one call that isn't a navigation: on mount, when
 * the view came from storage rather than the URL, the first history entry
 * has to be corrected in place so it describes what is actually on
 * screen. Pushing there would leave a Back step to the same page.
 */
export function rememberView(view: View, { replace = false } = {}): void {
  const url = new URL(window.location.href);
  // The list is the default, so it reads as no parameter at all — that
  // keeps the shared URL for the front door clean, and leaves ?stage=1
  // and anything else on the query string untouched.
  if (view === 'list') url.searchParams.delete(VIEW_PARAM);
  else url.searchParams.set(VIEW_PARAM, view);
  if (url.href !== window.location.href) {
    window.history[replace ? 'replaceState' : 'pushState'](null, '', url);
  }
  if (!import.meta.env.DEV) return;
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    // Not worth interrupting anyone over.
  }
}
