import { useMemo, useState } from 'react';
import type { TimelineMonth, TimelineYear, TimelineYearTopGame } from '../types/game';
import { ACHIEVEMENT_PLATFORM_COLORS } from '../utils/platformColors';
import TimelineInfoModal from './TimelineInfoModal';

const PLATFORM_ORDER = ['steam', 'psn', 'xbox', 'ra'] as const;
const YEAR_BAR_HEIGHT = 90;
const RAREST_LABELS = ['Rarest Pull', 'Second Rarest Pull', 'Third Rarest Pull'];

type Metric = 'achievements' | 'points';

function fmtScore(score: number): string {
  return Math.round(score).toLocaleString();
}

function YearBars({
  years,
  selectedYear,
  metric,
  onSelect,
}: {
  years: TimelineYear[];
  selectedYear: number | null;
  metric: Metric;
  onSelect: (year: number) => void;
}) {
  const value = (v: { count: number; score: number }) => (metric === 'points' ? v.score : v.count);
  const maxValue = Math.max(1, ...years.map((y) => value(y)));

  return (
    /* data-metric lets the CSS drop the counts earlier in points mode,
       where they are formatted with a thousands separator and run to six
       characters, than in achievements mode where they rarely pass three. */
    <div className="stats-year-bars" data-metric={metric}>
      {years.map((y, i) => (
        <div
          key={y.year}
          className={`stats-year-bar-col${y.year === selectedYear ? ' stats-year-bar-col--selected' : ''}`}
          title={`${y.year}: ${y.count} achievement${y.count === 1 ? '' : 's'}, ${y.score.toFixed(0)} pts`}
          onClick={() => onSelect(y.year)}
          role="button"
          style={{ animationDelay: `${i * 25}ms` }}
        >
          <span className="stats-year-bar-count">
            {metric === 'points' ? fmtScore(y.score) : y.count}
          </span>
          <div
            className="stats-year-bar"
            style={{ height: YEAR_BAR_HEIGHT, animationDelay: `${i * 25}ms` }}
          >
            {PLATFORM_ORDER.map((platform) => {
              const stat = y.platforms[platform];
              if (!stat || stat.count === 0) return null;
              return (
                <div
                  key={platform}
                  className="stats-year-bar-segment"
                  style={{
                    height: `${(value(stat) / maxValue) * YEAR_BAR_HEIGHT}px`,
                    background: ACHIEVEMENT_PLATFORM_COLORS[platform],
                  }}
                />
              );
            })}
          </div>
          <span className="stats-year-bar-label">{y.year}</span>
        </div>
      ))}
    </div>
  );
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTH_INITIALS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

function MonthSparkline({
  months,
  metric,
  visibleCount,
}: {
  months: TimelineMonth[];
  metric: Metric;
  // Months at or past this index haven't happened yet — the column
  // still occupies its grid slot (so earlier months don't stretch to
  // fill the gap), it just has no bar or tooltip.
  visibleCount: number;
}) {
  const value = (m: TimelineMonth) => (metric === 'points' ? m.score : m.count);
  const maxValue = Math.max(1, ...months.slice(0, visibleCount).map(value));

  return (
    <div className="stats-year-spark-block">
      <div className="stats-year-spark">
        {months.map((m, i) => {
          const future = i >= visibleCount;
          return (
            <div
              key={m.month}
              className="stats-year-spark-col"
              title={future ? undefined : `${MONTH_NAMES[i]}: ${m.count} achievement${m.count === 1 ? '' : 's'}, ${m.score.toFixed(0)} pts`}
            >
              <div className="stats-year-spark-track">
                {!future && (
                  <div
                    className="stats-year-spark-bar"
                    style={{ height: `${(value(m) / maxValue) * 100}%` }}
                  />
                )}
              </div>
              <span className="stats-year-spark-label">{MONTH_INITIALS[i]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function YearRecap({
  year,
  months,
  metric,
}: {
  year: TimelineYear;
  months: TimelineMonth[];
  metric: Metric;
}) {
  const topGames: TimelineYearTopGame[] =
    metric === 'points' ? year.topGamesByScore : year.topGamesByCount;
  const [hero, ...rest] = topGames;
  const { rarestAchievements } = year;
  const gameValue = (g: TimelineYearTopGame) => (metric === 'points' ? fmtScore(g.score) : g.count);

  // Matches the build script's UTC bucketing (see build-timeline.mjs)
  // so the cutoff lands on the same month boundary the data uses. Past
  // years always show all 12 — only the year still in progress has
  // months that haven't happened yet.
  const now = new Date();
  const monthsElapsed = year.year === now.getUTCFullYear() ? now.getUTCMonth() + 1 : 12;

  return (
    <div className="stats-year-recap">
      <div className="stats-year-recap-header">
        <span className="stats-year-recap-year">{year.year}</span>
        <span className="stats-year-recap-totals">
          {year.count} achievements &middot; {fmtScore(year.score)} pts
        </span>
      </div>

      <MonthSparkline months={months} metric={metric} visibleCount={monthsElapsed} />

      {/* Hero and the runners-up are one ranked run, so the spine spans
          both and ignites at No. 1 rather than starting at No. 2 — the
          top game is the head of the list, not a separate thing sitting
          above it. */}
      {(hero || rest.length > 0) && (
        <div className="stats-year-ranking trace-l">
          {hero && (
            <div className="stats-year-hero">
              {hero.icon && (
                <img className="stats-year-hero-art" src={hero.icon} alt="" aria-hidden="true" loading="lazy" />
              )}
              <div className="stats-year-hero-content">
                <span className="stats-year-hero-label">Top Game</span>
                <span className="stats-year-hero-title">{hero.title}</span>
              </div>
              <span className="stats-year-hero-count">{gameValue(hero)}</span>
            </div>
          )}

          {rest.length > 0 && (
            <ol className="stats-year-more-games">
              {rest.map((g, i) => (
                <li key={`${g.platform}/${g.id}`} className="stats-year-more-game">
                  <span className="stats-year-more-rank">{i + 2}</span>
                  <span className="stats-year-more-title">{g.title}</span>
                  <span className="stats-year-more-count">{gameValue(g)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {rarestAchievements.length > 0 && (
        <div className="stats-year-rarest-group">
          {rarestAchievements.map((r, i) => (
            <div key={i} className="stats-year-rarest">
              <span className="stats-year-rarest-rarity">{r.rarity}%</span>
              <div className="stats-year-rarest-body">
                <span className="stats-year-rarest-label">{RAREST_LABELS[i] ?? 'Rarest Pull'}</span>
                <span className="stats-year-rarest-name">{r.name}</span>
                <span className="stats-year-rarest-game">{r.gameTitle}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AchievementYears({
  months,
  years,
}: {
  months: TimelineMonth[];
  years: TimelineYear[];
}) {
  const [selectedYear, setSelectedYear] = useState<number | null>(
    () => years[years.length - 1]?.year ?? null,
  );
  const [metric, setMetric] = useState<Metric>('points');
  const [infoOpen, setInfoOpen] = useState(false);

  const selected = useMemo(
    () => years.find((y) => y.year === selectedYear) ?? null,
    [years, selectedYear],
  );

  const selectedMonths = useMemo(() => {
    if (selectedYear == null) return [];
    const byMonth = new Map(months.map((m) => [m.month, m]));
    return Array.from({ length: 12 }, (_, i) => {
      const monthKey = `${selectedYear}-${String(i + 1).padStart(2, '0')}`;
      return byMonth.get(monthKey) ?? { month: monthKey, count: 0, score: 0, platforms: {} };
    });
  }, [months, selectedYear]);

  if (years.length === 0) return null;

  return (
    <div className="stats-years trace-t">
      <div className="stats-years-heading">
        <div className="stats-years-title-row">
          <h2>{metric === 'points' ? 'Rarity Points' : 'Achievements'} By Year</h2>
          <button
            type="button"
            className="leaderboard-info-btn"
            onClick={() => setInfoOpen(true)}
            aria-label="How these numbers work"
            title="How these numbers work"
          >
            ?
          </button>
        </div>
        <div className="stats-metric-toggle" role="group" aria-label="Show by">
          <button
            type="button"
            className={`stats-metric-tab${metric === 'achievements' ? ' stats-metric-tab--active' : ''}`}
            onClick={() => setMetric('achievements')}
          >
            Achievements
          </button>
          <button
            type="button"
            className={`stats-metric-tab${metric === 'points' ? ' stats-metric-tab--active' : ''}`}
            onClick={() => setMetric('points')}
          >
            Rarity Points
          </button>
        </div>
      </div>
      <YearBars years={years} selectedYear={selectedYear} metric={metric} onSelect={setSelectedYear} />
      {selected && <YearRecap year={selected} months={selectedMonths} metric={metric} />}
      <TimelineInfoModal open={infoOpen} onClose={() => setInfoOpen(false)} />
    </div>
  );
}
