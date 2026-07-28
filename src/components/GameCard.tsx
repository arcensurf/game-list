import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameWithCover } from '../types/game';
import GameCardHud from './GameCardHud';
import CardBackFace from './CardBackFace';
import CoverPicker from './CoverPicker';

const MAX_COVER_RETRIES = 3;
const COVER_RETRY_BASE_MS = 500;

// Shared batch counter: cards revealed in the same animation frame get
// sequential stagger indexes starting at 0. The counter resets on the next
// frame, so a fresh batch of newly-visible cards always staggers from the top.
let batchCounter = 0;
let batchResetScheduled = false;

// Signal acquisition is a startup effect, not a per-image one. A lone cover
// flickering as you scroll past reads as a glitch; a whole screen of them
// doing it at once reads as the grid coming online. So the flicker is limited
// to the FIRST reveal batch of a mount wave — everything revealed later just
// fades in.
//
// "Mount wave" is the whole grid arriving at once, which is exactly the two
// moments that should re-arm the effect. There's no virtualization, so every
// card mounts up front on page load; and a view change unmounts all of them
// (App.tsx flushSync's <main> to null before swapping views) and mounts a
// fresh set. Tracking the mounted count and re-opening on the 0 -> 1 edge
// therefore catches page load and tab change without either needing to know
// about this at all.
let mountedCards = 0;
let acquisitionOpen = true;

function nextBatchIndex() {
  const i = batchCounter++;
  if (!batchResetScheduled) {
    batchResetScheduled = true;
    requestAnimationFrame(() => {
      batchCounter = 0;
      batchResetScheduled = false;
      // The first batch is now over, so close the window. Intersection
      // observations are delivered after rAF callbacks within a frame, which
      // means every card revealed in the opening batch has already read
      // acquisitionOpen while it was still true.
      acquisitionOpen = false;
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
  const [localCoverUrl, setLocalCoverUrl] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [coverLoaded, setCoverLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  const baseCoverUrl = localCoverUrl ?? game.coverUrl;
  const coverUrl = baseCoverUrl && retryCount > 0
    ? baseCoverUrl.split('?')[0] + '?retry=' + retryCount
    : baseCoverUrl;

  // onLoad alone isn't enough. An image served from the memory cache can
  // finish before React commits the handler, so the event never reaches us
  // and the cover skips its lock-on animation — the effect would work on a
  // cold load and silently vanish on every repeat visit. Checking `complete`
  // after commit catches those. naturalWidth guards the broken-image case,
  // where `complete` is also true but there's nothing to show.
  //
  // Keyed on coverUrl so a retry (or a dev cover swap) re-arms the animation
  // rather than leaving the card stuck in its already-loaded state.
  useEffect(() => {
    setCoverLoaded(false);
    const el = imgRef.current;
    if (el?.complete && el.naturalWidth > 0) setCoverLoaded(true);
  }, [coverUrl]);

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
  const [flipped, setFlipped] = useState(false);
  const ffxivDetail = game.achievements?.ffxiv;
  const canFlip = !!ffxivDetail;
  const toggleFlip = useCallback(() => setFlipped((f) => !f), []);
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
  const [reveal, setReveal] = useState<{ index: number; acquiring: boolean } | null>(null);

  // Mount-wave bookkeeping for the acquisition window. Deliberately its own
  // effect rather than folded into the observer below, which can bail early
  // on a missing ref — that would increment without ever decrementing and
  // leave the count permanently above zero, so no later view change would
  // re-open the window.
  useEffect(() => {
    if (mountedCards === 0) acquisitionOpen = true;
    mountedCards++;
    return () => {
      mountedCards--;
    };
  }, []);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            // Captured at reveal time, not at load time. A cover in the
            // opening screen that takes seconds to arrive still belongs to
            // the acquisition wave and should flicker when it lands.
            setReveal({ index: nextBatchIndex(), acquiring: acquisitionOpen });
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
    flipped ? 'flipped' : '',
    canFlip ? 'can-flip' : '',
    reveal !== null ? 'revealed' : '',
    reveal?.acquiring ? 'acquiring' : '',
  ].filter(Boolean).join(' ');

  // Non-flippable cards render the cover as a direct child of
  // .game-card — same DOM structure they always had, so existing CSS
  // (foil, GoG, etc.) doesn't need to know about a wrapper. Only
  // flippable cards introduce the flipper + back face.
  const cover = (
    <div
      className={`game-card-cover${coverLoaded ? ' cover-loaded' : ''}`}
      onClick={import.meta.env.DEV ? () => setPickerOpen(true) : undefined}
      style={import.meta.env.DEV ? { cursor: 'pointer' } : undefined}
    >
      {coverUrl && !imgError ? (
        <img
          ref={imgRef}
          src={coverUrl}
          alt={game.title}
          loading="lazy"
          decoding="async"
          onLoad={() => setCoverLoaded(true)}
          onError={() => {
            // Retry in production too, not just dev. Covers are served
            // from a shared host that throttles bursts, and a page view
            // asks it for every cover at once — so a failure here is
            // usually "too many at once," not "missing." Falling
            // straight through to the placeholder made a transient
            // throttle permanent for that card until a full refresh.
            if (retryCount < MAX_COVER_RETRIES) {
              // Exponential backoff: retrying immediately just walks
              // back into the same wall. Returning early also means we
              // don't flip to the placeholder mid-retry, so a cover
              // that recovers never flashes its title text.
              const delay = COVER_RETRY_BASE_MS * 2 ** retryCount;
              setTimeout(() => setRetryCount((c) => c + 1), delay);
              return;
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
      <GameCardHud game={game} canFlip={canFlip} onFlip={toggleFlip} />
    </div>
  );

  return (
    <div
      ref={cardRef}
      className={cardClasses}
      style={{ ['--card-index' as string]: reveal?.index ?? 0 } as React.CSSProperties}
      onTouchStart={import.meta.env.DEV ? undefined : handleTouchStart}
      onTouchEnd={import.meta.env.DEV ? undefined : handleTouchEnd}
    >
      {canFlip && ffxivDetail ? (
        <div className="game-card-flipper">
          <div className="game-card-face game-card-face--front">{cover}</div>
          <div className="game-card-face game-card-face--back">
            <CardBackFace detail={ffxivDetail} onFlip={toggleFlip} />
          </div>
        </div>
      ) : (
        cover
      )}
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
    </div>
  );
}
