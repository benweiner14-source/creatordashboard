import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

import RecapPage from '@/app/recap/page';

describe('RecapPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    pushMock.mockClear();
  });

  it('shows the handle form when no platforms are connected yet', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ handles: { youtube: null, tiktok: null, instagram: null }, recapCardId: null }),
      })
    );
    render(<RecapPage />);
    await waitFor(() => expect(screen.getByLabelText(/youtube channel handle/i)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /generate this month/i })).not.toBeInTheDocument();
  });

  it('redirects straight to the card page when this month already has one', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ handles: { youtube: 'creator', tiktok: null, instagram: null }, recapCardId: 'card-1' }),
      })
    );
    render(<RecapPage />);
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/recap/card-1'));
  });

  it('shows the generate button once a platform is connected, and generating redirects to the new card', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ handles: { youtube: 'creator', tiktok: null, instagram: null }, recapCardId: null }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ recapCard: { id: 'card-2' } }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<RecapPage />);
    await waitFor(() => screen.getByRole('button', { name: /generate this month/i }));
    fireEvent.click(screen.getByRole('button', { name: /generate this month/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/recap/card-2'));
    expect(fetchMock).toHaveBeenLastCalledWith('/api/recap', { method: 'POST' });
  });

  it('shows an error and a retry button when generation fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ handles: { youtube: 'creator', tiktok: null, instagram: null }, recapCardId: null }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Looks like nothing was published on your connected platforms this month yet.' }),
      });
    vi.stubGlobal('fetch', fetchMock);

    render(<RecapPage />);
    await waitFor(() => screen.getByRole('button', { name: /generate this month/i }));
    fireEvent.click(screen.getByRole('button', { name: /generate this month/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('nothing was published'));
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('saves handles and shows the generate button on success', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ handles: { youtube: null, tiktok: null, instagram: null }, recapCardId: null }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<RecapPage />);
    await waitFor(() => screen.getByLabelText(/youtube channel handle/i));
    fireEvent.change(screen.getByLabelText(/youtube channel handle/i), { target: { value: 'creator' } });
    fireEvent.click(screen.getByRole('button', { name: /save platforms/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: /generate this month/i })).toBeInTheDocument());
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/recap/handles',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ youtube: 'creator', tiktok: '', instagram: '' }),
      })
    );
  });
});
