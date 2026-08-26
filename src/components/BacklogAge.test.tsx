import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BacklogAge from './BacklogAge';
import { HEAT_CEILING_DAYS } from '../utils/backlogAge';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-26T12:00:00'));
});
afterEach(() => vi.useRealTimers());

const heatOf = (el: HTMLElement) => Number(el.style.getPropertyValue('--age-heat'));

describe('BacklogAge', () => {
  it('renders nothing for an entry with no stamp', () => {
    const { container } = render(<BacklogAge addedAt={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for an unparseable stamp', () => {
    const { container } = render(<BacklogAge addedAt="soon" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the day count', () => {
    render(<BacklogAge addedAt="2026-08-01" />);
    expect(screen.getByText('25')).toBeInTheDocument();
    expect(screen.getByText('days')).toBeInTheDocument();
  });

  it('says "day" singular at one day', () => {
    render(<BacklogAge addedAt="2026-08-25" />);
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('day')).toBeInTheDocument();
  });

  it('renders on the day it was added', () => {
    render(<BacklogAge addedAt="2026-08-26" />);
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('days')).toBeInTheDocument();
  });

  it('exposes the stamp in the title for hover', () => {
    const { container } = render(<BacklogAge addedAt="2026-08-01" />);
    expect(container.querySelector('.backlog-band-age')).toHaveAttribute('title', 'Added 2026-08-01');
  });

  it('ramps heat from cold at zero days to full at the ceiling', () => {
    const { container: fresh } = render(<BacklogAge addedAt="2026-08-26" />);
    expect(heatOf(fresh.querySelector<HTMLElement>('.backlog-band-age')!)).toBe(0);

    const { container: mid } = render(<BacklogAge addedAt="2026-02-26" />);
    const midHeat = heatOf(mid.querySelector<HTMLElement>('.backlog-band-age')!);
    expect(midHeat).toBeGreaterThan(0);
    expect(midHeat).toBeLessThan(1);
  });

  it('clamps heat at 1 past the ceiling instead of overshooting', () => {
    const { container } = render(<BacklogAge addedAt="2020-01-01" />);
    const el = container.querySelector<HTMLElement>('.backlog-band-age')!;
    expect(heatOf(el)).toBe(1);
    expect(Number(el.textContent!.replace(/\D/g, ''))).toBeGreaterThan(HEAT_CEILING_DAYS);
  });
});
