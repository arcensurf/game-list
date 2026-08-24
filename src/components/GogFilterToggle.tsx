import LampToggle from './LampToggle';

/* The Games of Games filter, on the same cable-box key as the Leaderboard's
   controls — square lamp, label printed alongside, no box around either.

   Its one departure: the lit key is the foil itself rather than a flat
   colour. The iridescent frame is how a GoG card announces itself (see
   game-of-games.css), so the control that summons them wears the same
   thing at key scale — and it's the reason the chip this replaced was
   worth keeping any part of. See .gog-lamp in layout.css. */
export default function GogFilterToggle({
  on,
  onToggle,
}: {
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <LampToggle
      on={on}
      className="gog-lamp"
      onClick={onToggle}
      title={on ? 'Show every game' : 'Show only Games of Games'}
      label={
        <>
          {/* Two labels, swapped by width in layout.css — the long one
              crowds the alphabet nav on a phone, and display:none keeps
              the hidden one out of the accessibility tree either way. */}
          <span className="gog-lamp-long">Games of Games</span>
          <span className="gog-lamp-short">GoG</span>
        </>
      }
    />
  );
}
