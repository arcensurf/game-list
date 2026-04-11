import { useState } from 'react';
import { useGames } from '../hooks/useGames';
import GameGrid from './GameGrid';
import AddGameForm from './AddGameForm';
import PublishButton from './PublishButton';
import StatsModal from './StatsModal';

const ALL_LETTERS = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')];

export default function App() {
  const [filter, setFilter] = useState('');
  const [gogOnly, setGogOnly] = useState(false);
  const [perfectOnly, setPerfectOnly] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const { groups, totalCount, platformStats, loading } = useGames(
    filter || undefined,
    gogOnly,
    perfectOnly,
  );
  const activeLetters = new Set(groups.map((g) => g.letter));
  const flatLayout = gogOnly || perfectOnly;

  return (
    <div className="app">
      <header className="app-header">
        <h1>The Games List</h1>
        <p className="game-count">
          {totalCount} games completed
          {' '}
          <button className="stats-btn" onClick={() => setStatsOpen(true)}>
            Stats
          </button>
          <button
            className={`stats-btn${gogOnly ? ' gog-active' : ''}`}
            onClick={() => setGogOnly(!gogOnly)}
          >
            Games of Games
          </button>
          <button
            className={`stats-btn${perfectOnly ? ' gog-active' : ''}`}
            onClick={() => setPerfectOnly(!perfectOnly)}
          >
            Perfect Games
          </button>
        </p>
        <div className="header-controls">
          <input
            type="search"
            className="search-input"
            placeholder="Filter by title or platform..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          {import.meta.env.DEV && <AddGameForm />}
          {import.meta.env.DEV && <PublishButton />}
        </div>
      </header>

      {!flatLayout && (
        <nav className="alphabet-nav">
          {ALL_LETTERS.map((letter) => (
            <a
              key={letter}
              href={`#section-${letter}`}
              className={activeLetters.has(letter) ? 'active' : 'inactive'}
            >
              {letter}
            </a>
          ))}
        </nav>
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
    </div>
  );
}
