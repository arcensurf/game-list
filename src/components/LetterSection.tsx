import type { LetterGroup } from '../types/game';
import GameCard from './GameCard';

export default function LetterSection({ group }: { group: LetterGroup }) {
  return (
    <section className="letter-section" id={`section-${group.letter}`}>
      <h2 className="letter-heading">{group.letter}</h2>
      <div className="game-grid">
        {group.games.map((game) => (
          <GameCard key={game.title} game={game} />
        ))}
      </div>
    </section>
  );
}
