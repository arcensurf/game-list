import { useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import type { TimelineMonth, TimelineYear, TimelineYearTopGame } from '../types/game';
import { ACHIEVEMENT_PLATFORM_COLORS, PLATFORM_TINT_FALLBACK } from '../utils/platformColors';
import { formatDate } from '../utils/leaderboardFormat';
import TimelineInfoModal from './TimelineInfoModal';
import SwitchInfoModal from './SwitchInfoModal';
import LeaderboardGameModal from './LeaderboardGameModal';
import type { LeaderboardModalTarget } from './LeaderboardGameModal';
import PlatformPill from './PlatformPill';
import Thumb from './Thumb';
import { useSwitchBeatenByYear } from '../hooks/useSwitchBeatenByYear';
import type { SwitchBeatenGame } from '../hooks/useSwitchBeatenByYear';

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

// Own component so the loaded/not-loaded state is per-image, not shared
// across the grid. Same reasoning as GameCard's coverLoaded: checking
// `complete` after mount catches an image served from the memory cache
// finishing before React commits onLoad, which onLoad alone would miss.
function SwitchCover({ src }: { src: string }) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const el = imgRef.current;
    if (el?.complete && el.naturalWidth > 0) setLoaded(true);
  }, [src]);

  return (
    <>
      <span
        className={`stats-year-switch-grain${loaded ? ' stats-year-switch-grain--off' : ''}`}
        aria-hidden="true"
      />
      <img
        ref={imgRef}
        className={`stats-year-switch-img${loaded ? ' stats-year-switch-img--loaded' : ''}`}
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
      />
    </>
  );
}

function YearRecap({
  year,
  months,
  metric,
  switchGames,
}: {
  year: TimelineYear;
  months: TimelineMonth[];
  metric: Metric;
  switchGames: SwitchBeatenGame[];
}) {
  const topGames: TimelineYearTopGame[] =
    metric === 'points' ? year.topGamesByScore : year.topGamesByCount;
  const [hero, ...rest] = topGames;
  const { rarestAchievements, completions } = year;
  const gameValue = (g: TimelineYearTopGame) => (metric === 'points' ? fmtScore(g.score) : g.count);
  const [modalTarget, setModalTarget] = useState<LeaderboardModalTarget | null>(null);
  const [switchInfoOpen, setSwitchInfoOpen] = useState(false);

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

      {/* Last in the recap, on purpose — its row count varies year to
          year (zero completions some years, several others) more than
          anything above it, so it's the block whose height changing is
          least likely to shift something else. Above the rarest pulls,
          every switch between a heavy and a light completions year
          would've bounced that group up and down with it; here only
          the bottom of the page moves. */}
      {completions.length > 0 && (
        <div className="stats-year-completions">
          <span className="stats-year-completions-label">100% Completions</span>
          <ol className="leaderboard-list">
            {completions.map((c, i) => (
              <li
                key={`${c.platform}/${c.id}`}
                className="leaderboard-row leaderboard-row--complete"
                style={{ ['--row-index' as string]: i } as React.CSSProperties}
                role="button"
                tabIndex={0}
                onClick={() => setModalTarget({ platform: c.platform, id: c.id, title: c.title })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setModalTarget({ platform: c.platform, id: c.id, title: c.title });
                  }
                }}
              >
                <span
                  className="leaderboard-row-art leaderboard-row-art--tint"
                  style={
                    {
                      ['--row-tint' as string]: c.tint ?? PLATFORM_TINT_FALLBACK[c.platform] ?? '#6f7684',
                    } as React.CSSProperties
                  }
                  aria-hidden="true"
                />
                <Thumb platform={c.platform} gameId={c.id} icon={c.icon} />
                <div className="leaderboard-main">
                  <div className="leaderboard-title">{c.title}</div>
                  <div className="leaderboard-meta">
                    <PlatformPill platform={c.platform} />
                    <span className="leaderboard-completion leaderboard-completion--complete">✓ 100%</span>
                  </div>
                </div>
                <span className="stats-year-completion-date">{formatDate(c.completedAt)}</span>
              </li>
            ))}
          </ol>
          <LeaderboardGameModal target={modalTarget} onClose={() => setModalTarget(null)} />
        </div>
      )}

      {/* Switch/Switch 2 have no achievements at all, so a year of
          clears there is otherwise invisible on this entire page — see
          useSwitchBeatenByYear. Weighted as a major section (h2 +
          trace-t divider, same recipe as "Rarity Points By Year" and
          "Beaten Games Per Platform" above it), not a footnote under
          the achievement recap — it's telling you about a console this
          whole page is otherwise blind to, which earns more than an
          eyebrow label. Plain cover art rather than the leaderboard row
          format the sections above use: there's no platform pill,
          completion %, or score to show, since none of that exists for
          these. Last, same reasoning as completions above it — its
          count is exactly as unpredictable year to year. */}
      {switchGames.length > 0 && (
        <div className="stats-year-switch trace-t">
          <div className="stats-years-title-row">
            <h2>Nintendon&rsquo;t</h2>
            <button
              type="button"
              className="leaderboard-info-btn"
              onClick={() => setSwitchInfoOpen(true)}
              aria-label="What this section is"
              title="What this section is"
            >
              ?
            </button>
          </div>
          <SwitchInfoModal open={switchInfoOpen} onClose={() => setSwitchInfoOpen(false)} />
          <div className="stats-year-switch-grid">
            {switchGames.map((g) => (
              <div key={g.title} className="stats-year-switch-item" title={g.title}>
                <div className="stats-year-switch-cover">
                  {g.coverUrl ? (
                    <SwitchCover src={g.coverUrl} />
                  ) : (
                    <span className="stats-year-switch-cover-placeholder">{g.title}</span>
                  )}
                </div>
                <span className="stats-year-switch-title">{g.title}</span>
              </div>
            ))}
          </div>
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
  const { data: switchByYear } = useSwitchBeatenByYear();

  const selected = useMemo(
    () => years.find((y) => y.year === selectedYear) ?? null,
    [years, selectedYear],
  );

  const selectedSwitchGames = useMemo(
    () => switchByYear?.find((y) => y.year === selectedYear)?.games ?? [],
    [switchByYear, selectedYear],
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
      {selected && (
        <YearRecap year={selected} months={selectedMonths} metric={metric} switchGames={selectedSwitchGames} />
      )}
      <TimelineInfoModal open={infoOpen} onClose={() => setInfoOpen(false)} />
    </div>
  );
}
