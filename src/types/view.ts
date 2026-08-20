export type View = 'list' | 'gog' | 'perfect' | 'backlog' | 'stats' | 'picker';

// The trophy picker writes through the dev API, so it has no meaning on
// the deployed site — it only joins the nav and the swipe order locally.
export const VIEW_ORDER: View[] = import.meta.env.DEV
  ? ['list', 'gog', 'perfect', 'backlog', 'picker']
  : ['list', 'gog', 'perfect', 'backlog'];

// OBS points a browser source straight at ?stage=1 so the capture comes
// back up on the picker after a restart, with no clicking required.
export function getInitialView(): View {
  if (!import.meta.env.DEV) return 'list';
  return new URLSearchParams(window.location.search).get('stage') === '1'
    ? 'picker'
    : 'list';
}
