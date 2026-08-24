/* Corner brackets — the app's framing device, used instead of a bordered
   box. Four spans, one per corner, so a region reads as *marked out*
   rather than boxed in.

   Geometry is driven entirely by custom properties set on the framed
   container (--bracket-size / --bracket-inset / --bracket-color /
   --bracket-opacity, see frame.css), which is what lets one object serve
   both a 10px corner inside a card HUD and a large section frame in a
   stats view. Anything that needs its own scale sets the vars; nothing
   needs its own geometry.

   `variant` adds a second, namespaced class per corner (variant="hud"
   yields `hud-bracket hud-bracket--tl`) for the few places that need to
   target one corner specifically — the card flip button displaces the
   top-right bracket, for instance. */
const CORNERS = ['tl', 'tr', 'bl', 'br'] as const;

export default function Brackets({ variant }: { variant?: string }) {
  return (
    <>
      {CORNERS.map((corner) => (
        <span
          key={corner}
          className={
            `frame-bracket frame-bracket--${corner}` +
            (variant ? ` ${variant}-bracket ${variant}-bracket--${corner}` : '')
          }
          aria-hidden
        />
      ))}
    </>
  );
}
