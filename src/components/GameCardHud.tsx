import type { GameWithCover } from '../types/game';
import PlatformBadge from './PlatformBadge';
import ExtrasList from './DlcPopover';

export default function GameCardHud({
  game,
  onEdit,
}: {
  game: GameWithCover;
  onEdit?: () => void;
}) {
  return (
    <div className="game-card-info card-hud">
      <span className="hud-bracket hud-bracket--tl" aria-hidden />
      <span className="hud-bracket hud-bracket--tr" aria-hidden />
      <span className="hud-bracket hud-bracket--bl" aria-hidden />
      <span className="hud-bracket hud-bracket--br" aria-hidden />
      <div className="card-hud-header">
        {game.gameOfGames && (
          <div className="card-hud-gog-label" aria-hidden>
            <span className="card-hud-gog-title">▸ A GAME OF GAMES</span>
            <span className="card-hud-gog-tagline">{game.gameOfGames}</span>
          </div>
        )}
        <h3 className="game-card-title">{game.title}</h3>
        {game.subtitle && (
          <p className="game-card-subtitle">{game.subtitle}</p>
        )}
      </div>
      <div className="card-hud-footer">
        {game.extras.length > 0 && <ExtrasList extras={game.extras} />}
        <div className="game-card-platforms">
          {game.platforms.map((p) => (
            <PlatformBadge key={p} platform={p} />
          ))}
          {onEdit && (
            <button
              className="dev-edit-btn"
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              title="Edit game metadata"
            >
              Edit
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
