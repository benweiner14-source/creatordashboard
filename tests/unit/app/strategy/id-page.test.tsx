import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'strategy-1' }),
}));

// AppNav calls usePathname() (not part of this page's own concerns) and
// makes its own independent fetch('/api/session') call that would race
// against this file's per-test fetch stubs. Mocking it out here matches
// every other page test in this codebase (home, ideas, recap, diagnostic,
// strategy) — AppNav's own behavior is already covered by its dedicated suite.
vi.mock('@/components/AppNav', () => ({
  AppNav: () => null,
}));

import StrategyBreakdownPage from '@/app/strategy/[id]/page';

const BREAKDOWN = {
  platform: 'tiktok',
  channel_handle: 'creator',
  post_count: 12,
  cadence: { postCount: 12, spanDays: 30, postsPerWeek: 2.8, mostCommonDayOfWeek: 'Tuesday' },
  format_mix: { averageDurationSeconds: 35, shortPct: 80, mediumPct: 20, longPct: 0 },
  top_posts: [{ captionOrTitle: 'Wait for it', viewCount: 50000 }],
  headline: 'Short, frequent posts are driving this channel',
  explanation: 'This channel posts short-form content often, which keeps the algorithm engaged.',
};

describe('StrategyBreakdownPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the headline, stats, and explanation once loaded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ breakdown: BREAKDOWN }) }));

    render(<StrategyBreakdownPage />);

    expect(screen.getByText(/loading your breakdown/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Short, frequent posts are driving this channel')).toBeInTheDocument());
    expect(screen.getByText(/2\.8/)).toBeInTheDocument();
    expect(screen.getByText('Tuesday')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
  });

  it('shows an error message when the breakdown is not found', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ error: 'Strategy breakdown not found.' }) }));
    render(<StrategyBreakdownPage />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Strategy breakdown not found.'));
  });
});
