import { useState } from 'react';
import type { GameWithCover } from '../types/game';
import EditGameModal from './EditGameModal';

// Dev-only controls that live outside the card-hud overlay so
// editing UI doesn't interfere with previewing HUD content
// (platforms rotation, extras ticker, etc.) during development.
export default function DevEditControls({ game }: { game: GameWithCover }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        className="dev-edit-btn dev-edit-btn--external"
        onClick={() => setOpen(true)}
        title="Edit game metadata"
      >
        Edit
      </button>
      {open && <EditGameModal game={game} onClose={() => setOpen(false)} />}
    </>
  );
}
