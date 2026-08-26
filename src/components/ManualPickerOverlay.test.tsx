import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ManualPickerOverlay from './ManualPickerOverlay';
import type { ShardPlatform } from '../hooks/useAchievementList';

const game = (id: string, title: string, platform: ShardPlatform = 'steam') => ({
  platform,
  id,
  title,
  unearned: 5,
  coverUrl: null,
  iconUrl: null,
});

const GAMES = [game('1', 'Alpha'), game('2', 'Beta')];

const props = (over = {}) => ({
  open: true,
  onClose: vi.fn(),
  games: GAMES,
  minRarity: 0,
  onSelect: vi.fn(),
  ...over,
});

const search = () => screen.getByPlaceholderText('Search games...') as HTMLInputElement;

describe('ManualPickerOverlay', () => {
  it('renders nothing while closed', () => {
    const { container } = render(<ManualPickerOverlay {...props({ open: false })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('filters the game list by the search box', () => {
    render(<ManualPickerOverlay {...props()} />);
    fireEvent.change(search(), { target: { value: 'alph' } });
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.queryByText('Beta')).not.toBeInTheDocument();
  });

  it('clears the search on reopen rather than restoring where it was left', () => {
    const { rerender } = render(<ManualPickerOverlay {...props()} />);
    fireEvent.change(search(), { target: { value: 'alph' } });
    expect(search().value).toBe('alph');

    rerender(<ManualPickerOverlay {...props({ open: false })} />);
    rerender(<ManualPickerOverlay {...props({ open: true })} />);
    expect(search().value).toBe('');
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('keeps the search while the overlay stays open', () => {
    // The reset fires on the open transition, not on every render —
    // an unrelated prop change must not wipe what was typed.
    const { rerender } = render(<ManualPickerOverlay {...props()} />);
    fireEvent.change(search(), { target: { value: 'alph' } });

    rerender(<ManualPickerOverlay {...props({ minRarity: 20 })} />);
    expect(search().value).toBe('alph');
  });

  it('opens on the game list when mounted closed and opened later', () => {
    const { rerender } = render(<ManualPickerOverlay {...props({ open: false })} />);
    rerender(<ManualPickerOverlay {...props({ open: true })} />);
    expect(search().value).toBe('');
    expect(screen.getByText('Alpha')).toBeInTheDocument();
  });
});
