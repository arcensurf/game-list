import { useEffect, useRef, useState } from 'react';
import type { FfxivCategoryData, FfxivCharacterData } from '../types/game';
import meteorIcon from '../icons/svg/outline/meteor.svg';

// The back face is FFXIV-only for now — but the component is shaped
// around "a game has richer data than fits on the HUD." If we ever
// get per-game narrative detail elsewhere, this stays as the
// reusable "back of the card" surface and CardBackFace takes a
// render-prop for the content.

type Mode = 'achievements' | 'points';

// Auto-cycle cadence: each mode holds long enough to read the 8-cell
// grid, then the scanline sweeps through and swaps in the other mode.
// 4.5s hold matches the "Share Tech Mono marquee" rhythm elsewhere in
// the HUD (extras 14s cycle = ~5s visible per page). Sweep duration
// (500ms) runs top→bottom during which numbers fade through zero and
// mode swaps at the midpoint — see card-back.css for the animation.
const MODE_HOLD_MS = 4500;
const SWEEP_MS = 500;

export default function CardBackFace({
  detail,
  onFlip,
}: {
  detail: FfxivCharacterData;
  onFlip: () => void;
}) {
  const [mode, setMode] = useState<Mode>('achievements');
  const [sweeping, setSweeping] = useState(false);

  // Auto-cycle: start sweep → swap mode mid-sweep → end sweep. The
  // mode swap at the midpoint means the numbers fade out on the old
  // mode and fade back in on the new one, while the scanline keeps
  // moving through the whole transition. The inner timeouts aren't
  // tracked for cleanup — clearing the interval stops new sweeps,
  // and SWEEP_MS (500ms) is short enough that an in-flight sweep on
  // unmount is fine to let finish.
  useEffect(() => {
    const t = setInterval(() => {
      setSweeping(true);
      setTimeout(() => {
        setMode((m) => (m === 'achievements' ? 'points' : 'achievements'));
      }, SWEEP_MS / 2);
      setTimeout(() => {
        setSweeping(false);
      }, SWEEP_MS);
    }, MODE_HOLD_MS);
    return () => clearInterval(t);
  }, []);

  const pct = (earned: number, total: number) =>
    total > 0 ? Math.round((earned / total) * 100) : 0;

  const overall = mode === 'achievements'
    ? { earned: detail.earned, total: detail.total, unit: '' }
    : { earned: detail.pointsEarned, total: detail.pointsTotal, unit: ' pts' };

  return (
    <div
      className={`card-back-face card-back-face--${mode}${sweeping ? ' card-back-face--sweeping' : ''}`}
    >
      <span className="hud-bracket hud-bracket--tl" aria-hidden />
      <span className="hud-bracket hud-bracket--tr" aria-hidden />
      <span className="hud-bracket hud-bracket--bl" aria-hidden />
      <span className="hud-bracket hud-bracket--br" aria-hidden />

      <button
        type="button"
        className="card-flip-button card-flip-button--back"
        onClick={(e) => {
          e.stopPropagation();
          onFlip();
        }}
        aria-label="Flip card back"
        style={{
          maskImage: `url(${meteorIcon})`,
          WebkitMaskImage: `url(${meteorIcon})`,
        }}
      />

      <div className="card-back-header">
        <div className="card-back-eyebrow">
          {mode === 'achievements' ? '◂ ACHIEVEMENTS ▸' : '◂ POINTS ▸'}
        </div>
        <div className="card-back-total">
          <span className="card-back-total-earned">{overall.earned.toLocaleString()}</span>
          <span className="card-back-total-sep">/</span>
          <span className="card-back-total-of">{overall.total.toLocaleString()}{overall.unit}</span>
        </div>
        <div className="card-back-percent">{pct(overall.earned, overall.total)}% complete</div>
      </div>

      <div className="card-back-grid">
        {detail.categories.map((cat) => (
          <CategoryCell key={cat.id} cat={cat} mode={mode} />
        ))}
      </div>

      <div className="card-back-scanline" aria-hidden />
    </div>
  );
}

// Individual cell — owns its own overflow detection so a long name
// (e.g. "Crafting & Gathering") marquee-scrolls instead of getting
// truncated. Detection runs once on mount: we measure the single-copy
// render, then flip to duplicated content that loops seamlessly.
function CategoryCell({ cat, mode }: { cat: FfxivCategoryData; mode: Mode }) {
  const nameRef = useRef<HTMLDivElement>(null);
  const [scrolling, setScrolling] = useState(false);

  useEffect(() => {
    const el = nameRef.current;
    if (!el) return;
    if (el.scrollWidth > el.clientWidth + 1) {
      setScrolling(true);
    }
  }, []);

  const earned = mode === 'achievements' ? cat.earned : cat.pointsEarned;
  const total = mode === 'achievements' ? cat.total : cat.pointsTotal;
  const p = total > 0 ? Math.round((earned / total) * 100) : 0;

  return (
    <div
      className="card-back-cell"
      title={`${cat.name}: ${earned.toLocaleString()}/${total.toLocaleString()}`}
    >
      <div
        ref={nameRef}
        className={`card-back-cell-name${scrolling ? ' card-back-cell-name--scrolling' : ''}`}
      >
        <span className="card-back-cell-name-inner">
          {cat.name}
          {scrolling && (
            <>
              <span className="card-back-cell-name-gap" aria-hidden />
              {cat.name}
            </>
          )}
        </span>
      </div>
      <div className="card-back-cell-bar">
        <div className="card-back-cell-fill" style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}
