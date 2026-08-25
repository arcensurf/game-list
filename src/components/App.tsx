import { useCallback, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { useGames } from '../hooks/useGames';
import { useGogFilter } from '../hooks/useGogFilter';
import { useLeaderboardFilters } from '../hooks/useLeaderboardFilters';
import { useCardSpotlight } from '../hooks/useCardSpotlight';
import { useViewSwipe } from '../hooks/useViewSwipe';
import { useScrollReset } from '../hooks/useScrollReset';
import { useMastheadFlip } from '../hooks/useMastheadFlip';
import AlphabetNav from './AlphabetNav';
import GogFilterToggle from './GogFilterToggle';
import LeaderboardFilterToggles from './LeaderboardFilterToggles';
import GameGrid from './GameGrid';
import BacklogList from './BacklogList';
import AddGameForm from './AddGameForm';
import PublishButton from './PublishButton';
import TrophyPickerView from './TrophyPickerView';
import LeaderboardView from './LeaderboardView';
import StatsView from './StatsView';
import DataLoadFailure from './DataLoadFailure';
import BottomNav from './BottomNav';
import { getInitialView, rememberView } from '../types/view';
import type { View } from '../types/view';

export default function App() {
  const [view, setView] = useState<View>(getInitialView);
  const lightsOn = false;
  const [inTransition, setInTransition] = useState(false);

  const { gogOnly, toggleGog } = useGogFilter(view);
  const leaderboardFilters = useLeaderboardFilters(view);
  const backlogView = view === 'backlog';
  const statsView = view === 'stats';
  // Gated on DEV at the point of use, not just kept out of VIEW_ORDER:
  // without this the view stays reachable code and Rollup ships the
  // whole picker (and its dev-API calls) to the public bundle.
  const pickerView = import.meta.env.DEV && view === 'picker';
  const leaderboardView = view === 'leaderboard';

  // Only the grid views (list/backlog) render individual game cards, so
  // only they need covers.json + achievements.json merged in — Stats
  // reads just platformStats, which comes straight off games.json. See
  // the `detailed` param on useGames.
  const { groups, totalCount, platformStats, loading, failed, retry } = useGames(
    undefined,
    gogOnly,
    backlogView ? 'backlog' : 'beaten',
    view === 'list' || backlogView,
  );
  const activeLetters = new Set(groups.map((g) => g.letter));
  const effectiveLightsOn = lightsOn || gogOnly || statsView || backlogView || pickerView || leaderboardView;

  const changeView = useCallback((next: View) => {
    rememberView(next);
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
  useScrollReset(`${view}${gogOnly ? ':gog' : ''}`);
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
                : backlogView
                  ? 'in the backlog'
                  : 'games completed'}
            </p>
            {/* The masthead only flips on the list view, so the leaderboard's
                modifiers live on the title face where they are always
                reachable — not behind a flip that never happens. */}
            {view === 'leaderboard' && <LeaderboardFilterToggles {...leaderboardFilters} />}
          </div>
          <div className="masthead-face masthead-face--letters">
            {view === 'list' && (
              <>
                {/* A filtered grid is a flat handful of cards with no
                    letter sections to jump to, so the nav gives way. */}
                {!gogOnly && (
                  <>
                    <AlphabetNav activeLetters={activeLetters} />
                    <div className="masthead-divider" aria-hidden="true" />
                  </>
                )}
                <GogFilterToggle on={gogOnly} onToggle={toggleGog} />
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
        {inTransition ? null : pickerView ? (
          <TrophyPickerView />
        ) : leaderboardView ? (
          <LeaderboardView
            hideDupes={leaderboardFilters.hideDupes}
            completionsOnly={leaderboardFilters.completionsOnly}
          />
        ) : statsView ? (
          <StatsView stats={platformStats} />
        ) : loading ? (
          <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '4rem 0' }}>
            Loading...
          </p>
        ) : failed ? (
          <DataLoadFailure onRetry={retry} />
        ) : backlogView ? (
          <BacklogList games={groups.flatMap((g) => g.games)} />
        ) : (
          <GameGrid groups={groups} flat={gogOnly} />
        )}
      </main>

      <BottomNav view={view} onChange={changeView} />
    </div>
  );
}
