/* A cable-box key: a square lamp with its label printed alongside rather
   than inside it.

   The split is the whole point. On a physical panel the legend is printed
   on the case and only the lamp changes, so the label never has to dim to
   express state — which is what went wrong with the filled-chip version,
   where the off state tinted the text along with the fill and lost
   contrast on the lighter platform colours.

   `color` is the lit colour; it defaults to the accent for filters that
   have no identity of their own. */
export default function LampToggle({
  on,
  color,
  label,
  title,
  onClick,
  disabled,
  className,
}: {
  on: boolean;
  color?: string;
  label: string;
  title?: string;
  onClick: () => void;
  disabled?: boolean;
  /** Extra class for per-context sizing; the base `lamp-toggle` is always applied. */
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`lamp-toggle${on ? ' lamp-toggle--on' : ''}${className ? ` ${className}` : ''}`}
      style={color ? ({ ['--lamp-color' as string]: color } as React.CSSProperties) : undefined}
      onClick={onClick}
      title={title}
      disabled={disabled}
      aria-pressed={on}
    >
      <span className="lamp-toggle-key" aria-hidden="true" />
      <span className="lamp-toggle-label">{label}</span>
    </button>
  );
}
