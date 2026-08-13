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
