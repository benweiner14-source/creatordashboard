// tests/unit/app/recap/id-page.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'recap-1' }),
}));

import RecapCardPage from '@/app/recap/[id]/page';

describe('RecapCardPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the month heading, the card image, and a download link', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({
          recapCard: {
            month: '2026-08-01',
            totals: { views: 127000, likes: 8200, comments: 430, postCount: 14 },
            topPost: { platform: 'tiktok', captionOrTitle: 'Wait for it...', viewCount: 52000, permalink: 'https://tiktok.com/@creator/video/1' },
          },
        }),
      })
    );

    render(<RecapCardPage />);

    expect(screen.getByText(/loading your recap card/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('heading', { name: /august 2026 recap/i })).toBeInTheDocument());
    expect(screen.getByRole('img')).toHaveAttribute('src', '/recap/recap-1/image');
    expect(screen.getByRole('link', { name: /download image/i })).toHaveAttribute('href', '/recap/recap-1/image');
  });

  it('links back to the handle form so the month is not a dead end', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({
          recapCard: {
            month: '2026-08-01',
            totals: { views: 127000, likes: 8200, comments: 430, postCount: 14 },
            topPost: { platform: 'tiktok', captionOrTitle: 'Wait for it...', viewCount: 52000, permalink: 'https://tiktok.com/@creator/video/1' },
            warnings: [],
          },
        }),
      })
    );

    render(<RecapCardPage />);

    await waitFor(() =>
      expect(screen.getByRole('link', { name: /manage platforms/i })).toHaveAttribute('href', '/recap?edit=1')
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('tells the creator which platforms could not be reached when the card was generated', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({
          recapCard: {
            month: '2026-08-01',
            totals: { views: 127000, likes: 8200, comments: 430, postCount: 14 },
            topPost: { platform: 'tiktok', captionOrTitle: 'Wait for it...', viewCount: 52000, permalink: 'https://tiktok.com/@creator/video/1' },
            warnings: ['instagram_scrape_failed'],
          },
        }),
      })
    );

    render(<RecapCardPage />);

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Instagram couldn't be reached/i));
  });

  it('names every failed platform when more than one could not be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({
          recapCard: {
            month: '2026-08-01',
            totals: { views: 127000, likes: 8200, comments: 430, postCount: 14 },
            topPost: { platform: 'youtube', captionOrTitle: 'Wait for it...', viewCount: 52000, permalink: 'https://youtube.com/watch?v=1' },
            warnings: ['tiktok_scrape_failed', 'instagram_scrape_failed'],
          },
        }),
      })
    );

    render(<RecapCardPage />);

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('TikTok and Instagram'));
  });

  it('shows an error message when the recap card is not found', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ error: 'Recap card not found.' }) }));
    render(<RecapCardPage />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Recap card not found.'));
  });

  it('shows an error message when the network request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
    render(<RecapCardPage />);
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong loading this recap card. Please try again.')
    );
  });
});
