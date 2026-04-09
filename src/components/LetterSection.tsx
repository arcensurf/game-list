import { useState, useRef, useCallback } from 'react';
import type { LetterGroup, GameWithCover } from '../types/game';
import GameCard from './GameCard';

export default function LetterSection({ group }: { group: LetterGroup }) {
  const [games, setGames] = useState(group.games);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
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
    setDropIndex(index);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
    setDropIndex(null);
    dragItem.current = null;
  }, []);

  const handleDrop = useCallback(async (index: number) => {
    const from = dragItem.current;
    if (from === null || from === index) {
      handleDragEnd();
      return;
    }

    const reordered = [...games];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(index, 0, moved);

    setGames(reordered);
    handleDragEnd();

    await fetch('/api/reorder-games', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        titles: reordered.map((g: GameWithCover) => g.title),
      }),
    });
  }, [games, handleDragEnd]);

  const getCardClass = (index: number) => {
    if (!isDev) return undefined;
    const classes = ['draggable-card'];
    if (dragIndex === index) classes.push('dragging');
    if (dropIndex === index && dragIndex !== null && dragIndex !== index) {
      classes.push(dragIndex < index ? 'drop-after' : 'drop-before');
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
            onDrop={isDev ? () => handleDrop(index) : undefined}
            onDragEnd={isDev ? handleDragEnd : undefined}
            className={getCardClass(index)}
          >
            <GameCard game={game} />
          </div>
        ))}
      </div>
    </section>
  );
}
