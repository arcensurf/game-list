import { useCallback, useEffect, useRef, useState } from 'react';

const ALL_LETTERS = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')];

export default function AlphabetNav({ activeLetters }: { activeLetters: Set<string> }) {
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
        {ALL_LETTERS.map((letter) => (
          <a
            key={letter}
            href={`#section-${letter}`}
            className={activeLetters.has(letter) ? 'active' : 'inactive'}
            onClick={(e) => {
              if (!activeLetters.has(letter)) return;
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
