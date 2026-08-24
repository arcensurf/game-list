export default function GogFilterToggle({
  on,
  onToggle,
}: {
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`gog-filter-toggle${on ? ' gog-filter-toggle--on' : ''}`}
      onClick={onToggle}
      aria-pressed={on}
      title={on ? 'Show every game' : 'Show only Games of Games'}
    >
      {/* Two labels, swapped by width in layout.css — the long one
          crowds the alphabet nav on a phone, and display:none keeps
          the hidden one out of the accessibility tree either way. */}
      <span className="gog-filter-toggle-long">Games of Games</span>
      <span className="gog-filter-toggle-short">GoG</span>
    </button>
  );
}
