export type View = 'list' | 'gog' | 'perfect' | 'stats';

export const VIEW_ORDER: View[] = ['list', 'gog', 'perfect', 'stats'];

const LABELS: Record<View, string> = {
  list: 'All Games',
  gog: 'Games of Games',
  perfect: 'Perfect Games',
  stats: 'Stats',
};

export default function BottomNav({
  view,
  onChange,
}: {
  view: View;
  onChange: (v: View) => void;
}) {
  return (
    <nav className="bottom-nav" aria-label="View">
      {VIEW_ORDER.map((v) => (
        <button
          key={v}
          className={`bottom-nav-tab${v === view ? ' bottom-nav-tab--active' : ''}`}
          onClick={() => onChange(v)}
        >
          {LABELS[v]}
        </button>
      ))}
    </nav>
  );
}
