import { useState } from 'react';
import { pickerCoverUrl, steamCoverFallback } from '../utils/pickerCover';
import xboxLogo from '../icons/svg/outline/xbox.svg';
import type { ShardPlatform } from '../hooks/useAchievementList';
import { useInView } from '../hooks/useInView';

// Same fallback chain as the picker's Cover component, minus the SGDB
// live lookup — that goes through a dev-only API route with nothing
// backing it on the deployed site, and this view is public. Shared by
// LeaderboardView and the Stats tab's year completions list — both are
// rows of achievement-tracked games needing the same cover.
export default function Thumb({
  platform,
  gameId,
  icon,
}: {
  platform: ShardPlatform;
  gameId: string;
  icon: string | null;
}) {
  const frameRef = useInView<HTMLSpanElement>();
  const [src, setSrc] = useState(pickerCoverUrl(platform, gameId, icon));
  if (!src) {
    // Xbox is the one platform where titleHub sometimes just omits box art
    // for a title (not a broken URL, an absent one — nothing for the
    // fetch-time re-hosting in fetch-achievements.mjs to act on), so it
    // gets a generic logo instead of an empty slot. Rare enough for the
    // other platforms that it isn't worth sourcing matching logos for them.
    if (platform === 'xbox') {
      return (
        <span className="leaderboard-thumb-frame" ref={frameRef}>
          <div className="leaderboard-thumb leaderboard-thumb--fallback">
          <span
            className="leaderboard-thumb--fallback-icon"
            style={{ maskImage: `url(${xboxLogo})`, WebkitMaskImage: `url(${xboxLogo})` }}
            />
          </div>
        </span>
      );
    }
    return (
      <span className="leaderboard-thumb-frame" ref={frameRef}>
        <div className="leaderboard-thumb leaderboard-thumb--empty" />
      </span>
    );
  }
  return (
    <span className="leaderboard-thumb-frame" ref={frameRef}>
      <img
        className="leaderboard-thumb"
        src={src}
        alt=""
        // The list renders up to 100 rows, so eager loading asked the host
        // for 100 thumbnails to show about a dozen. Every other cover in
        // the app already defers; this one didn't.
        loading="lazy"
        decoding="async"
        onError={() => {
          const fallback = steamCoverFallback(gameId);
          if (platform === 'steam' && src !== fallback) setSrc(fallback);
          else if (icon && src !== icon) setSrc(icon);
          else setSrc(null);
        }}
      />
    </span>
  );
}
