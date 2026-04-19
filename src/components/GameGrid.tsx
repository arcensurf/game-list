import type { LetterGroup } from '../types/game';
import LetterSection from './LetterSection';
import GameCard from './GameCard';
import DevEditControls from './DevEditControls';

const isDev = import.meta.env.DEV;

export default function GameGrid({ groups, flat }: { groups: LetterGroup[]; flat?: boolean }) {
  if (flat) {
    const allGames = groups.flatMap((g) => g.games);
    return (
      <div className="game-grid-container">
        <div className="game-grid">
          {allGames.map((game) => (
            <div key={game.title}>
              <GameCard game={game} compactGogLabel />
              {isDev && <DevEditControls game={game} />}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="game-grid-container">
      {groups.map((group) => (
        <LetterSection key={group.letter} group={group} />
      ))}
    </div>
  );
}
