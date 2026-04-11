import { useState, useRef, useCallback } from 'react';
import type { LetterGroup, GameWithCover } from '../types/game';
import GameCard from './GameCard';
import AchievementBar from './AchievementBar';

type DropSide = 'before' | 'after';

export default function LetterSection({ group }: { group: LetterGroup }) {
  const [games, setGames] = useState(group.games);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{ index: number; side: DropSide } | null>(null);
  const dragItem = useRef<number | null>(null);

  // Sync if parent data changes (e.g. after filter)
  if (
    games.length !== group.games.length ||
    games.some((g, i) => g.title !== group.games[i]?.title)
  ) {
    setGames(group.games);
  }

  const isDev = import.meta.env.DEV;

  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    dragItem.current = index;
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    const side: DropSide = e.clientX < midX ? 'before' : 'after';
    setDropTarget({ index, side });
  }, []);

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
    setDropTarget(null);
    dragItem.current = null;
  }, []);

  const handleDrop = useCallback(async () => {
    const from = dragItem.current;
    if (from === null || !dropTarget) {
      handleDragEnd();
      return;
    }

    let toIndex = dropTarget.side === 'after' ? dropTarget.index + 1 : dropTarget.index;
    // Adjust for the removal of the dragged item
    if (from < toIndex) toIndex--;
    if (from === toIndex) {
      handleDragEnd();
      return;
    }

    const reordered = [...games];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(toIndex, 0, moved);

    setGames(reordered);
    handleDragEnd();

    await fetch('/api/reorder-games', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        titles: reordered.map((g: GameWithCover) => g.title),
      }),
    });
  }, [games, dropTarget, handleDragEnd]);

  const getCardClass = (index: number) => {
    if (!isDev) return undefined;
    const classes = ['draggable-card'];
    if (dragIndex === index) classes.push('dragging');
    if (dropTarget && dragIndex !== null && dropTarget.index === index && dragIndex !== index) {
      classes.push(dropTarget.side === 'before' ? 'drop-before' : 'drop-after');
    }
    return classes.join(' ');
  };

  return (
    <section className="letter-section" id={`section-${group.letter}`}>
      <h2 className="letter-heading">{group.letter}</h2>
      <div className="game-grid">
        {games.map((game, index) => (
          <div
            key={game.title}
            draggable={isDev}
            onDragStart={isDev ? (e) => handleDragStart(e, index) : undefined}
            onDragOver={isDev ? (e) => handleDragOver(e, index) : undefined}
            onDrop={isDev ? handleDrop : undefined}
            onDragEnd={isDev ? handleDragEnd : undefined}
            className={getCardClass(index)}
          >
            <GameCard game={game} />
            <AchievementBar achievements={game.achievements} />
          </div>
        ))}
      </div>
    </section>
  );
}
