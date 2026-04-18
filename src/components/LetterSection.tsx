import { useState, useRef, useCallback } from 'react';
import type { LetterGroup, GameWithCover } from '../types/game';
import GameCard from './GameCard';
import AchievementBar from './AchievementBar';

type DropSide = 'before' | 'after';

export default function LetterSection({ group }: { group: LetterGroup }) {
  // Local state only exists for optimistic drag reorder. We track which
  // prop reference we last synced from so that ANY upstream change
  // (extras, order, title, deletion…) is picked up immediately.
  const [games, setGames] = useState(group.games);
  const [syncedFrom, setSyncedFrom] = useState(group.games);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{ index: number; side: DropSide } | null>(null);
  const dragItem = useRef<number | null>(null);

  if (syncedFrom !== group.games) {
    setGames(group.games);
    setSyncedFrom(group.games);
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

    const previous = games;
    const reordered = [...games];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(toIndex, 0, moved);

    setGames(reordered);
    handleDragEnd();

    try {
      const res = await fetch('/api/reorder-games', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          titles: reordered.map((g: GameWithCover) => g.title),
        }),
      });
      if (res.ok) {
        window.dispatchEvent(new Event('games-updated'));
      } else {
        setGames(previous);
      }
    } catch {
      setGames(previous);
    }
  }, [games, dropTarget, handleDragEnd]);

  const getCardClass = (index: number) => {
    // card-wrapper is always applied so layout (flex column + bar slot)
    // works in both dev and prod. draggable-card + drag-state classes
    // are dev-only.
    const classes = ['card-wrapper'];
    if (isDev) {
      classes.push('draggable-card');
      if (dragIndex === index) classes.push('dragging');
      if (dropTarget && dragIndex !== null && dropTarget.index === index && dragIndex !== index) {
        classes.push(dropTarget.side === 'before' ? 'drop-before' : 'drop-after');
      }
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
            <div className="achievement-slot">
              <AchievementBar achievements={game.achievements} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
