import { daysOnBacklog, HEAT_CEILING_DAYS } from '../utils/backlogAge';

// The one thing every backlog entry can say for itself, whatever it
// runs on: how long it's been sitting there. Playtime and achievement
// progress only exist for the platforms with an API behind them, so a
// CD-i game and a Steam game are equally legible here and nowhere else.
export default function BacklogAge({ addedAt }: { addedAt?: string | null }) {
  const days = daysOnBacklog(addedAt);
  if (days === null) return null;

  // Ramps muted → accent across the first year, so the shelf-warmers
  // pull the eye without anything as blunt as a threshold badge.
  const heat = Math.min(days / HEAT_CEILING_DAYS, 1);

  return (
    <div
      className="backlog-band-age"
      style={{ ['--age-heat' as string]: heat.toFixed(3) }}
      title={`Added ${addedAt}`}
    >
      <span className="backlog-band-age-count">{days}</span>
      <span className="backlog-band-age-label">{days === 1 ? 'day' : 'days'}</span>
    </div>
  );
}
