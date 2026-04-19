import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameWithCover } from '../types/game';
import GameCardHud from './GameCardHud';
import CoverPicker from './CoverPicker';
import EditGameModal from './EditGameModal';

// Shared batch counter: cards revealed in the same animation frame get
// sequential stagger indexes starting at 0. The counter resets on the next
// frame, so a fresh batch of newly-visible cards always staggers from the top.
let batchCounter = 0;
let batchResetScheduled = false;
function nextBatchIndex() {
  const i = batchCounter++;
  if (!batchResetScheduled) {
    batchResetScheduled = true;
    requestAnimationFrame(() => {
      batchCounter = 0;
      batchResetScheduled = false;
    });
  }
  return i;
}

export default function GameCard({
  game,
  compactGogLabel = false,
}: {
  game: GameWithCover;
  compactGogLabel?: boolean;
}) {
  const [imgError, setImgError] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [localCoverUrl, setLocalCoverUrl] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const baseCoverUrl = localCoverUrl ?? game.coverUrl;
  const coverUrl = baseCoverUrl && retryCount > 0
    ? baseCoverUrl.split('?')[0] + '?retry=' + retryCount
    : baseCoverUrl;

  const handleCoverChanged = (newUrl: string) => {
    const stripped = newUrl.split('?')[0];
    const baseUrl = import.meta.env.BASE_URL;
    // API returns paths without the base prefix — add it if missing
    const prefixed = stripped.startsWith(baseUrl) ? stripped : baseUrl + stripped.replace(/^\//, '');
    setLocalCoverUrl(prefixed + '?t=' + Date.now());
    setImgError(false);
    setRetryCount(0);
    setPickerOpen(false);
  };

  const [infoOpen, setInfoOpen] = useState(false);
  const touchStartRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const openInfo = useCallback(() => {
    setInfoOpen(true);
    clearTimeout(dismissTimer.current);
    dismissTimer.current = setTimeout(() => setInfoOpen(false), 3000);
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY, t: Date.now() };
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = Math.abs(t.clientX - start.x);
    const dy = Math.abs(t.clientY - start.y);
    const dt = Date.now() - start.t;
    // Treat as a tap only if the finger barely moved AND the gesture
    // was quick. Scroll gestures can start slow, so a generous time
    // cap catches drags that paused before moving.
    if (dx > 12 || dy > 12 || dt > 400) return;
    if (infoOpen) {
      clearTimeout(dismissTimer.current);
      setInfoOpen(false);
    } else {
      openInfo();
    }
  }, [infoOpen, openInfo]);

  useEffect(() => {
    return () => clearTimeout(dismissTimer.current);
  }, []);

  const cardRef = useRef<HTMLDivElement>(null);
  const [revealIndex, setRevealIndex] = useState<number | null>(null);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setRevealIndex(nextBatchIndex());
            observer.disconnect();
            break;
          }
        }
      },
      { rootMargin: '100px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const cardClasses = [
    'game-card',
    game.gameOfGames ? 'game-of-games' : '',
    game.gameOfGames && compactGogLabel ? 'game-of-games--foil' : '',
    infoOpen ? 'info-open' : '',
    revealIndex !== null ? 'revealed' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      ref={cardRef}
      className={cardClasses}
      style={{ ['--card-index' as string]: revealIndex ?? 0 } as React.CSSProperties}
      onTouchStart={import.meta.env.DEV ? undefined : handleTouchStart}
      onTouchEnd={import.meta.env.DEV ? undefined : handleTouchEnd}
    >
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
            onError={() => {
              if (import.meta.env.DEV && retryCount < 3) {
                setTimeout(() => {
                  setRetryCount((c) => c + 1);
                  setImgError(false);
                }, 500);
              }
              setImgError(true);
            }}
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
        <GameCardHud
          game={game}
          onEdit={import.meta.env.DEV ? () => setEditOpen(true) : undefined}
        />
      </div>
      {game.gameOfGames && !compactGogLabel && (
        <div className="game-of-games-label">
          <span className="game-of-games-title">A Game of Games</span>
          <span className="game-of-games-tagline">{game.gameOfGames}</span>
        </div>
      )}
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
