import type { LetterGroup } from '../types/game';
import LetterSection from './LetterSection';

export default function GameGrid({ groups }: { groups: LetterGroup[] }) {
  return (
    <div className="game-grid-container">
      {groups.map((group) => (
        <LetterSection key={group.letter} group={group} />
      ))}
    </div>
  );
}
