import { useState } from 'react';
import type { GameWithCover } from '../types/game';
import PlatformBadge from './PlatformBadge';
import ExtrasPopover from './DlcPopover';
import CoverPicker from './CoverPicker';
import EditGameModal from './EditGameModal';

export default function GameCard({ game }: { game: GameWithCover }) {
  const [imgError, setImgError] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [localCoverUrl, setLocalCoverUrl] = useState<string | null>(null);

  const coverUrl = localCoverUrl ?? game.coverUrl;

  const handleCoverChanged = (newUrl: string) => {
    setLocalCoverUrl(newUrl + '?t=' + Date.now());
    setImgError(false);
    setPickerOpen(false);
  };

  return (
    <div className="game-card">
      <div
        className="game-card-cover"
        onClick={import.meta.env.DEV ? () => setPickerOpen(true) : undefined}
        style={import.meta.env.DEV ? { cursor: 'pointer' } : undefined}
      >
        {coverUrl && !imgError ? (
          <img
            src={coverUrl}
            alt={game.title}
            loading="lazy"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="game-card-placeholder">
            <span>{game.title}</span>
          </div>
        )}
        {import.meta.env.DEV && (
          <div className="dev-upload-overlay">
            <span>Change Image</span>
          </div>
        )}
        {game.extras.length > 0 && (
          <ExtrasPopover extras={game.extras} />
        )}
      </div>
      <div className="game-card-info">
        <h3 className="game-card-title">{game.title}</h3>
        {game.subtitle && (
          <p className="game-card-subtitle">{game.subtitle}</p>
        )}
        <div className="game-card-platforms">
          {game.platforms.map((p) => (
            <PlatformBadge key={p} platform={p} />
          ))}
          {import.meta.env.DEV && (
            <button
              className="dev-edit-btn"
              onClick={(e) => {
                e.stopPropagation();
                setEditOpen(true);
              }}
              title="Edit game metadata"
            >
              Edit
            </button>
          )}
        </div>
      </div>
      {pickerOpen && (
        <CoverPicker
          title={game.title}
          sgdbId={game.sgdbId}
          onClose={(newCoverUrl) => {
            if (newCoverUrl) {
              handleCoverChanged(newCoverUrl);
            } else {
              setPickerOpen(false);
            }
          }}
        />
      )}
      {editOpen && (
        <EditGameModal game={game} onClose={() => setEditOpen(false)} />
      )}
    </div>
  );
}
