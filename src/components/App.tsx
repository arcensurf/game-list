import { useCallback, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { useGames } from '../hooks/useGames';
import { useCardSpotlight } from '../hooks/useCardSpotlight';
import { useViewSwipe } from '../hooks/useViewSwipe';
import { useScrollReset } from '../hooks/useScrollReset';
import { useMastheadFlip } from '../hooks/useMastheadFlip';
import AlphabetNav from './AlphabetNav';
import GameGrid from './GameGrid';
import AddGameForm from './AddGameForm';
import PublishButton from './PublishButton';
import StatsView from './StatsView';
import BottomNav from './BottomNav';
import type { View } from '../types/view';

export default function App() {
  const [view, setView] = useState<View>('list');
  const [lightsOn, setLightsOn] = useState(false);
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
                  : 'games completed'}
            </p>
          </div>
          <div className="masthead-face masthead-face--letters">
            {view === 'list' && (
              <AlphabetNav activeLetters={activeLetters} />
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
