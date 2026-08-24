import type React from 'react';
import { PLATFORM_ICON } from '../utils/platformIcons';
import { getLightColor } from '../utils/platformColors';

// A chapter marker for the backlog's per-system sections. The platform
// logos appear elsewhere in the app as small rotated silhouettes tucked
// behind their own label (see PlatformBadge); here the logo leads the
// line at full size and upright, sitting on a rule that carries the
// platform's colour out to the edge.
export default function SystemHeading({
  platform,
  count,
}: {
  platform: string;
  count: number;
}) {
  const icon = PLATFORM_ICON[platform];

  return (
    <h2
      className="system-heading"
      style={{ ['--system-color' as string]: getLightColor(platform) } as React.CSSProperties}
    >
      {icon && (
        <span
          className={`system-heading-icon${icon.solid ? ' system-heading-icon--solid' : ''}`}
          aria-hidden="true"
          style={{
            maskImage: `url(${icon.url})`,
            WebkitMaskImage: `url(${icon.url})`,
          }}
        />
      )}
      <span className="system-heading-name">{platform}</span>
      <span className="system-heading-rule" aria-hidden="true" />
      <span className="system-heading-count">
        {count} {count === 1 ? 'game' : 'games'}
      </span>
    </h2>
  );
}
