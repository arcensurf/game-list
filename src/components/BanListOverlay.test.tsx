import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import BanListOverlay from './BanListOverlay';
import { banKey } from '../utils/bannedGames';
import type { BannedMap } from '../utils/bannedGames';
import type { ShardPlatform } from '../hooks/useAchievementList';

const game = (id: string, title: string, platform: ShardPlatform = 'steam') => ({
  platform,
  id,
  title,
  unearned: 5,
});

const GAMES = [game('1', 'Alpha'), game('2', 'Beta'), game('3', 'Gamma')];

const ban = (...keys: string[]): BannedMap =>
  Object.fromEntries(keys.map((k) => [k, { title: k, at: '2026-08-26T00:00:00.000Z' }]));

/** Row titles in rendered order — the thing the snapshot controls. */
const titles = () =>
  Array.from(screen.getByRole('dialog').querySelectorAll('.ban-row-title')).map(
    (el) => el.textContent ?? '',
  );

const props = (over = {}) => ({
  open: true,
  onClose: vi.fn(),
  games: GAMES,
  banned: {} as BannedMap,
  onToggle: vi.fn(),
  ...over,
});

describe('BanListOverlay', () => {
  it('renders nothing while closed', () => {
    const { container } = render(<BanListOverlay {...props({ open: false })} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('floats banned games to the top, then sorts by title', () => {
    render(<BanListOverlay {...props({ banned: ban(banKey('steam', '3')) })} />);
    expect(titles()[0]).toBe('Gamma');
  });

  it('reports how many of the library are excluded', () => {
    render(<BanListOverlay {...props({ banned: ban(banKey('steam', '1'), banKey('steam', '2')) })} />);
    expect(screen.getByText('2 of 3 excluded')).toBeInTheDocument();
  });

  it('holds the order steady when a game is banned while open', () => {
    // The whole point of the snapshot: banning a game while scrolled
    // partway down must not yank it (and everything around it) to the
    // top mid-scroll.
    const { rerender } = render(<BanListOverlay {...props()} />);
    const before = titles();
    expect(before[0]).toBe('Alpha');

    rerender(<BanListOverlay {...props({ banned: ban(banKey('steam', '3')) })} />);
    expect(titles()).toEqual(before);
  });

  it('re-sorts on the next open, so freshly banned games surface', () => {
    const banned = ban(banKey('steam', '3'));
    const { rerender } = render(<BanListOverlay {...props()} />);
    rerender(<BanListOverlay {...props({ banned })} />);
    expect(titles()[0]).toBe('Alpha');

    // Close, then reopen — the snapshot is retaken on the transition.
    rerender(<BanListOverlay {...props({ open: false, banned })} />);
    rerender(<BanListOverlay {...props({ open: true, banned })} />);
    expect(titles()[0]).toBe('Gamma');
  });

  it('takes a fresh snapshot on first open, not on mount', () => {
    // Mounted closed, opened later with bans already in place: the
    // snapshot must come from the open transition, not the initial
    // useState value captured while closed.
    const banned = ban(banKey('steam', '3'));
    const { rerender } = render(<BanListOverlay {...props({ open: false })} />);
    rerender(<BanListOverlay {...props({ open: true, banned })} />);
    expect(titles()[0]).toBe('Gamma');
  });

  it('keeps the live count current even while the order is frozen', () => {
    const { rerender } = render(<BanListOverlay {...props()} />);
    expect(screen.getByText('0 of 3 excluded')).toBeInTheDocument();

    rerender(<BanListOverlay {...props({ banned: ban(banKey('steam', '3')) })} />);
    expect(screen.getByText('1 of 3 excluded')).toBeInTheDocument();
  });
});
