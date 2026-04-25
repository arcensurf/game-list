import { useEffect, useRef, useState } from 'react';
import type { GameWithCover } from '../types/game';
import PlatformBadge from './PlatformBadge';
import ExtrasList from './DlcPopover';
import meteorIcon from '../icons/svg/outline/meteor.svg';

export default function GameCardHud({
  game,
  canFlip = false,
  onFlip,
}: {
  game: GameWithCover;
  canFlip?: boolean;
  onFlip?: () => void;
}) {
  const [platformsRotating, setPlatformsRotating] = useState(false);
  const platformsViewportRef = useRef<HTMLDivElement>(null);

  // Detect when the platforms row exceeds a single line. When it
  // does, CSS applies a rotation animation that cycles through rows
  // so badges past the first line still get visible on hover.
  useEffect(() => {
    const el = platformsViewportRef.current;
    if (!el) return;
    const check = () => {
      setPlatformsRotating(el.scrollHeight > el.clientHeight + 1);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [game.platforms.length]);

  return (
    <div className="game-card-info card-hud">
      <span className="hud-bracket hud-bracket--tl" aria-hidden />
      <span className="hud-bracket hud-bracket--tr" aria-hidden />
      <span className="hud-bracket hud-bracket--bl" aria-hidden />
      <span className="hud-bracket hud-bracket--br" aria-hidden />
      {canFlip && onFlip && (
        <button
          type="button"
          className="card-flip-button card-flip-button--front"
          onClick={(e) => {
            // Stop propagation so the mobile tap-to-toggle HUD handler
            // on the card doesn't also fire and immediately close us.
            e.stopPropagation();
            onFlip();
          }}
          aria-label="Show FFXIV achievements"
          style={{
            maskImage: `url(${meteorIcon})`,
            WebkitMaskImage: `url(${meteorIcon})`,
          }}
        />
      )}
      <div className="card-hud-header">
        {game.gameOfGames && (
          <div className="card-hud-gog-label" aria-hidden>
            <div className="card-hud-gog-label-inner">
              <span className="card-hud-gog-title">▸ A GAME OF GAMES</span>
              <span className="card-hud-gog-tagline">{game.gameOfGames}</span>
            </div>
          </div>
        )}
        <h3 className="game-card-title">{game.title}</h3>
      </div>
      <div className="card-hud-footer">
        {game.extras.length > 0 && <ExtrasList extras={game.extras} />}
        <div
          ref={platformsViewportRef}
          className={`game-card-platforms-viewport${platformsRotating ? ' game-card-platforms-viewport--rotating' : ''}`}
        >
          <div className="game-card-platforms">
            {game.platforms.map((p) => (
              <PlatformBadge key={p} platform={p} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
