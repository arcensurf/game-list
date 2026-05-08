import { useCallback, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { useGames } from '../hooks/useGames';
import { useCardSpotlight } from '../hooks/useCardSpotlight';
import { useViewSwipe } from '../hooks/useViewSwipe';
import { useScrollReset } from '../hooks/useScrollReset';
import { useMastheadFlip } from '../hooks/useMastheadFlip';
import AlphabetNav from './AlphabetNav';
import GameGrid from './GameGrid';
import BacklogList from './BacklogList';
import AddGameForm from './AddGameForm';
import PublishButton from './PublishButton';
import StatsView from './StatsView';
import StatsOverlay from './StatsOverlay';
import BottomNav from './BottomNav';
import type { View } from '../types/view';

export default function App() {
  const [view, setView] = useState<View>('list');
  const lightsOn = false;
  const [inTransition, setInTransition] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);

  const gogOnly = view === 'gog';
  const perfectOnly = view === 'perfect';
  const backlogView = view === 'backlog';
  const statsView = view === 'stats';
  const flatLayout = gogOnly || perfectOnly;

  const { groups, totalCount, platformStats, loading } = useGames(
    undefined,
    gogOnly,
    perfectOnly,
    backlogView ? 'backlog' : 'beaten',
  );
  const activeLetters = new Set(groups.map((g) => g.letter));
  const effectiveLightsOn = lightsOn || flatLayout || statsView || backlogView;

  const changeView = useCallback((next: View) => {
    flushSync(() => {
      setInTransition(true);
      setView(next);
    });
    requestAnimationFrame(() => {
      window.scrollTo(0, 0);
      setInTransition(false);
    });
  }, []);

  useEffect(() => {
    document.body.classList.toggle('lights-on', effectiveLightsOn);
  }, [effectiveLightsOn]);

  useCardSpotlight(!effectiveLightsOn);
  useScrollReset(view);
  const mastheadFlipped = useMastheadFlip(view);
  const { onTouchStart, onTouchEnd } = useViewSwipe(view, changeView);

  return (
    <div className="app" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
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
                  : backlogView
                    ? 'in the backlog'
                    : 'games completed'}
            </p>
          </div>
          <div className="masthead-face masthead-face--letters">
            {view === 'list' && (
              <>
                <AlphabetNav activeLetters={activeLetters} />
                <div className="masthead-divider" aria-hidden="true" />
                <button
                  className="stats-trigger"
                  onClick={() => setStatsOpen(true)}
                  aria-label="Open platform stats"
                >
                  <svg
                    viewBox="0 0 16 16"
                    width="14"
                    height="14"
                    aria-hidden="true"
                  >
                    <rect x="2" y="9" width="3" height="5" />
                    <rect x="6.5" y="6" width="3" height="8" />
                    <rect x="11" y="3" width="3" height="11" />
                  </svg>
                </button>
              </>
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
          <StatsView stats={platformStats} />
        ) : loading ? (
          <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '4rem 0' }}>
            Loading...
          </p>
        ) : backlogView ? (
          <BacklogList games={groups.flatMap((g) => g.games)} />
        ) : (
          <GameGrid groups={groups} flat={flatLayout} />
        )}
      </main>

      <BottomNav view={view} onChange={changeView} />
      <StatsOverlay
        open={statsOpen}
        onClose={() => setStatsOpen(false)}
        stats={platformStats}
      />
    </div>
  );
}
