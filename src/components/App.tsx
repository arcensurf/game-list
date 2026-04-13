import { useCallback, useEffect, useRef, useState } from 'react';
import { useGames } from '../hooks/useGames';
import { useCardSpotlight } from '../hooks/useCardSpotlight';
import GameGrid from './GameGrid';
import AddGameForm from './AddGameForm';
import PublishButton from './PublishButton';
import StatsModal from './StatsModal';

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
  const [gogOnly, setGogOnly] = useState(false);
  const [perfectOnly, setPerfectOnly] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [lightsOn, setLightsOn] = useState(false);
  const { groups, totalCount, platformStats, loading } = useGames(
    undefined,
    gogOnly,
    perfectOnly,
  );
  const activeLetters = new Set(groups.map((g) => g.letter));
  const flatLayout = gogOnly || perfectOnly;
  // Filter views force lights on — the spotlight doesn't add much when
  // you're already looking at a curated subset.
  const effectiveLightsOn = lightsOn || flatLayout;

  useEffect(() => {
    document.body.classList.toggle('lights-on', effectiveLightsOn);
  }, [effectiveLightsOn]);

  useCardSpotlight(!effectiveLightsOn);

  return (
    <div className="app">
      <header className="app-header">
        <h1>The Games List</h1>
        <p className="game-count">
          {totalCount} {gogOnly ? 'Games of Games' : perfectOnly ? 'Perfect Games' : 'games completed'}
        </p>
        <div className="header-toolbar">
          <button className="filter-chip" onClick={() => setStatsOpen(true)}>
            Stats
          </button>
          <button
            className={`filter-chip${gogOnly ? ' filter-chip--active-gold' : ''}`}
            onClick={() => {
              setGogOnly(!gogOnly);
              setPerfectOnly(false);
            }}
          >
            Games of Games
          </button>
          <button
            className={`filter-chip${perfectOnly ? ' filter-chip--active' : ''}`}
            onClick={() => {
              setPerfectOnly(!perfectOnly);
              setGogOnly(false);
            }}
          >
            Perfect Games
          </button>
        </div>
        {import.meta.env.DEV && (
          <div className="header-controls">
            <AddGameForm />
            <PublishButton />
          </div>
        )}
      </header>

      {!flatLayout && (
        <AlphabetNav letters={ALL_LETTERS} activeLetters={activeLetters} />
      )}

      <main>
        {loading ? (
          <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '4rem 0' }}>
            Loading...
          </p>
        ) : (
          <GameGrid groups={groups} flat={flatLayout} />
        )}
      </main>

      {statsOpen && (
        <StatsModal
          stats={platformStats}
          totalCount={totalCount}
          onClose={() => setStatsOpen(false)}
        />
      )}

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
    </div>
  );
}
