import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import GameCard from './GameCard';
import type { GameWithCover } from '../types/game';

const game = (over: Partial<GameWithCover> = {}): GameWithCover => ({
  title: 'Portal 2',
  subtitle: null,
  platforms: ['PC'],
  extras: [],
  sgdbId: null,
  coverOverride: null,
  gameOfGames: null,
  order: 0,
  coverUrl: 'https://example.test/covers/portal-2.webp',
  achievements: null,
  ...over,
});

const cover = (c: HTMLElement) => c.querySelector('.game-card-cover')!;
const img = (c: HTMLElement) => c.querySelector('img')!;
const isLockedOn = (c: HTMLElement) => cover(c).classList.contains('cover-loaded');

describe('GameCard cover load state', () => {
  it('starts un-locked-on before the image loads', () => {
    const { container } = render(<GameCard game={game()} />);
    expect(isLockedOn(container)).toBe(false);
  });

  it('locks on once the image fires load', () => {
    const { container } = render(<GameCard game={game()} />);
    fireEvent.load(img(container));
    expect(isLockedOn(container)).toBe(true);
  });

  it('re-arms when the cover URL changes, so a new cover animates in', () => {
    // The card instance is reused (GameGrid keys by title), so without
    // the reset a swapped cover would inherit the previous one's
    // locked-on state and skip its animation entirely.
    const { container, rerender } = render(<GameCard game={game()} />);
    fireEvent.load(img(container));
    expect(isLockedOn(container)).toBe(true);

    rerender(<GameCard game={game({ coverUrl: 'https://example.test/covers/other.webp' })} />);
    expect(isLockedOn(container)).toBe(false);

    fireEvent.load(img(container));
    expect(isLockedOn(container)).toBe(true);
  });

  it('stays locked on across a re-render that does not change the cover', () => {
    // The reset keys on the URL, not on every render — an unrelated prop
    // change must not restart the animation.
    const { container, rerender } = render(<GameCard game={game()} />);
    fireEvent.load(img(container));

    rerender(<GameCard game={game({ subtitle: 'Now with portals' })} />);
    expect(isLockedOn(container)).toBe(true);
  });

  it('locks on immediately for an image already complete from cache', () => {
    // An image served from the memory cache can finish before React
    // commits onLoad, so the event never arrives — the post-commit
    // `complete` check is the only thing that catches those.
    const proto = window.HTMLImageElement.prototype;
    const complete = Object.getOwnPropertyDescriptor(proto, 'complete');
    const natural = Object.getOwnPropertyDescriptor(proto, 'naturalWidth');
    Object.defineProperty(proto, 'complete', { configurable: true, get: () => true });
    Object.defineProperty(proto, 'naturalWidth', { configurable: true, get: () => 600 });
    try {
      const { container } = render(<GameCard game={game()} />);
      expect(isLockedOn(container)).toBe(true);
    } finally {
      if (complete) Object.defineProperty(proto, 'complete', complete);
      if (natural) Object.defineProperty(proto, 'naturalWidth', natural);
    }
  });

  it('renders a placeholder and no image when there is no cover', () => {
    const { container } = render(<GameCard game={game({ coverUrl: null })} />);
    expect(container.querySelector('img')).toBeNull();
    expect(isLockedOn(container)).toBe(false);
  });
});
