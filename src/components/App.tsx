import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useGames } from '../hooks/useGames';
import { useCardSpotlight } from '../hooks/useCardSpotlight';
import GameGrid from './GameGrid';
import AddGameForm from './AddGameForm';
import PublishButton from './PublishButton';
import StatsView from './StatsView';
import BottomNav, { VIEW_ORDER } from './BottomNav';
import type { View } from './BottomNav';

const ALL_LETTERS = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')];

function AlphabetNav({ letters, activeLetters }: { letters: string[]; activeLetters: Set<string> }) {
  const scrollRef = useRef<HTMLElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateArrows = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 2);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateArrows();
    el.addEventListener('scroll', updateArrows, { passive: true });
    window.addEventListener('resize', updateArrows);
    return () => {
      el.removeEventListener('scroll', updateArrows);
      window.removeEventListener('resize', updateArrows);
    };
  }, [updateArrows]);

  const scroll = (dir: number) => {
    scrollRef.current?.scrollBy({ left: dir * 150, behavior: 'smooth' });
  };

  return (
    <div className="alphabet-nav-wrapper">
      {canScrollLeft && (
        <button className="alphabet-arrow alphabet-arrow--left" onClick={() => scroll(-1)} aria-label="Scroll left">
          ‹
        </button>
      )}
      <nav className="alphabet-nav" ref={scrollRef}>
        {letters.map((letter) => (
          <a
            key={letter}
            href={`#section-${letter}`}
            className={activeLetters.has(letter) ? 'active' : 'inactive'}
            onClick={(e) => {
              if (!activeLetters.has(letter)) return;
              // iOS Safari fights anchor jumps when scroll-snap is active —
              // the target scrolls in then the snap yanks it back. Handle
              // it ourselves: disable snap for the duration of the scroll.
              e.preventDefault();
              const target = document.getElementById(`section-${letter}`);
              if (!target) return;
              const html = document.documentElement;
              const prevSnap = html.style.scrollSnapType;
              html.style.scrollSnapType = 'none';
              target.scrollIntoView({ behavior: 'smooth', block: 'start' });
              window.setTimeout(() => {
                html.style.scrollSnapType = prevSnap;
              }, 800);
            }}
          >
            {letter}
          </a>
        ))}
      </nav>
      {canScrollRight && (
        <button className="alphabet-arrow alphabet-arrow--right" onClick={() => scroll(1)} aria-label="Scroll right">
          ›
        </button>
      )}
    </div>
  );
}

export default function App() {
  const [view, setView] = useState<View>('list');
  const [lightsOn, setLightsOn] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [dwelled, setDwelled] = useState(false);
  const [inTransition, setInTransition] = useState(false);

  const gogOnly = view === 'gog';
  const perfectOnly = view === 'perfect';
  const statsView = view === 'stats';
  const flatLayout = gogOnly || perfectOnly;

  const { groups, totalCount, platformStats, loading } = useGames(
    undefined,
    gogOnly,
    perfectOnly,
  );
  const activeLetters = new Set(groups.map((g) => g.letter));
  const effectiveLightsOn = lightsOn || flatLayout || statsView;

  // The trickiest scroll behavior to beat is browser scroll preservation
  // when content shrinks. The most reliable workaround is to unmount
  // the main content entirely for a frame so the page collapses to
  // just the masthead — the browser is then forced to clamp scroll to
  // 0 before the new content mounts.
  const changeView = useCallback((next: View) => {
    flushSync(() => {
      setInTransition(true);
      setView(next);
    });
    // After the empty frame has committed, restore the content.
    requestAnimationFrame(() => {
      window.scrollTo(0, 0);
      setInTransition(false);
    });
  }, []);

  useEffect(() => {
    document.body.classList.toggle('lights-on', effectiveLightsOn);
  }, [effectiveLightsOn]);

  // Flip the masthead from title to letter nav once the user has
  // scrolled past the header's nominal height.
  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 80);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Also flip after 3s of dwell time so the letter selector surfaces
  // itself even for users who haven't started scrolling yet. Resets
  // on view change, so returning to the list re-shows the title and
  // then flips again after 3 more seconds of dwell.
  useEffect(() => {
    setDwelled(false);
    if (view !== 'list') return;
    const t = window.setTimeout(() => setDwelled(true), 3000);
    return () => window.clearTimeout(t);
  }, [view]);

  useCardSpotlight(!effectiveLightsOn);

  // On each view change: disable scroll-snap, scroll to the top, then
  // re-enable snap once the user scrolls. useLayoutEffect + scrollTop
  // runs before paint so the user never sees the stale scroll
  // position. Multiple retries catch browser-side scroll-clamping
  // that happens post-render when content shrinks (Firefox, notably,
  // clamps back after our initial reset).
  useLayoutEffect(() => {
    const html = document.documentElement;
    html.style.scrollSnapType = 'none';
    const scroll = () => {
      html.scrollTop = 0;
      if (document.body) document.body.scrollTop = 0;
    };
    scroll();
    const timers = [0, 16, 50, 150, 300].map((ms) =>
      window.setTimeout(scroll, ms),
    );
    const enable = () => {
      html.style.scrollSnapType = '';
    };
    const readyId = window.setTimeout(() => {
      window.addEventListener('scroll', enable, { passive: true, once: true });
    }, 400);
    return () => {
      timers.forEach((id) => window.clearTimeout(id));
      window.clearTimeout(readyId);
      html.style.scrollSnapType = '';
      window.removeEventListener('scroll', enable);
    };
  }, [view]);

  // Swipe between views on touch devices. The bottom nav drives the
  // same state for click/keyboard users.
  const swipeStart = useRef<{ x: number; y: number; t: number } | null>(null);
  const handleSwipeStart = useCallback((e: React.TouchEvent) => {
    // Don't capture swipes that start inside a horizontally-scrollable
    // element (the alphabet nav), or the user's sideways scroll on
    // that element becomes a view change instead.
    const target = e.target as HTMLElement | null;
    if (target?.closest('.alphabet-nav')) {
      swipeStart.current = null;
      return;
    }
    const t = e.touches[0];
    swipeStart.current = { x: t.clientX, y: t.clientY, t: Date.now() };
  }, []);
  const handleSwipeEnd = useCallback(
    (e: React.TouchEvent) => {
      const start = swipeStart.current;
      swipeStart.current = null;
      if (!start) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - start.x;
      const dy = Math.abs(t.clientY - start.y);
      const dt = Date.now() - start.t;
      // Horizontal swipe: distance > 60px, clearly horizontal, under half a second.
      if (Math.abs(dx) < 60 || Math.abs(dx) < dy * 1.4 || dt > 500) return;
      const idx = VIEW_ORDER.indexOf(view);
      if (dx < 0 && idx < VIEW_ORDER.length - 1) {
        changeView(VIEW_ORDER[idx + 1]);
      } else if (dx > 0 && idx > 0) {
        changeView(VIEW_ORDER[idx - 1]);
      }
    },
    [view, changeView],
  );

  // Only flip to the letter selector in the main list view — the
  // curated subset views (GoG/Perfect/Stats) keep the title sticky.
  const showMastheadFlip = view === 'list';
  const mastheadFlipped = showMastheadFlip && (scrolled || dwelled);

  return (
    <div className="app" onTouchStart={handleSwipeStart} onTouchEnd={handleSwipeEnd}>
      <div
        className={`masthead${mastheadFlipped ? ' masthead--flipped' : ''}`}
      >
        <div className="masthead-inner">
          <div className="masthead-face masthead-face--title">
            <h1>The Games List</h1>
            <p className="game-count">
              {totalCount}{' '}
              {gogOnly
                ? 'Games of Games'
                : perfectOnly
                  ? 'Perfect Games'
                  : 'games completed'}
            </p>
          </div>
          <div className="masthead-face masthead-face--letters">
            {showMastheadFlip && (
              <AlphabetNav letters={ALL_LETTERS} activeLetters={activeLetters} />
            )}
          </div>
        </div>
      </div>
      {import.meta.env.DEV && (
        <div className="header-controls">
          <AddGameForm />
          <PublishButton />
        </div>
      )}

      <main>
        {inTransition ? null : statsView ? (
          <StatsView stats={platformStats} totalCount={totalCount} />
        ) : loading ? (
          <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '4rem 0' }}>
            Loading...
          </p>
        ) : (
          <GameGrid groups={groups} flat={flatLayout} />
        )}
      </main>

      {!statsView && (
        <button
          className={`lights-toggle${effectiveLightsOn ? ' lights-toggle--on' : ''}`}
          onClick={() => setLightsOn(!lightsOn)}
          disabled={flatLayout}
          title={
            flatLayout
              ? 'Lights stay on while a filter is active'
              : effectiveLightsOn
                ? 'Re-enable the spotlight effect'
                : 'Turn all the lights on'
          }
        >
          {effectiveLightsOn ? 'Lights On' : 'Lights Off'}
        </button>
      )}

      <BottomNav view={view} onChange={changeView} />
    </div>
  );
}
