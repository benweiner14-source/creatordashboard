import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const pushMock = vi.fn();
let searchParams = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => searchParams,
}));

import RecapPage from '@/app/recap/page';

describe('RecapPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    pushMock.mockClear();
    searchParams = new URLSearchParams();
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

  it('stays on the handle form instead of redirecting when ?edit=1 is present', async () => {
    searchParams = new URLSearchParams('edit=1');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ handles: { youtube: 'creator', tiktok: null, instagram: null }, recapCardId: 'card-1' }),
      })
    );

    render(<RecapPage />);

    await waitFor(() => expect(screen.getByLabelText(/youtube channel handle/i)).toHaveValue('creator'));
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('lets a creator edit and save a handle after a failed generation', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ handles: { youtube: 'typo', tiktok: null, instagram: null }, recapCardId: null }),
      })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Generation blew up.' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<RecapPage />);
    await waitFor(() => screen.getByRole('button', { name: /generate this month/i }));
    fireEvent.click(screen.getByRole('button', { name: /generate this month/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Generation blew up.'));

    // The field must actually accept the keystroke, not silently swallow it.
    fireEvent.change(screen.getByLabelText(/youtube channel handle/i), { target: { value: 'creator' } });
    expect(screen.getByLabelText(/youtube channel handle/i)).toHaveValue('creator');

    fireEvent.click(screen.getByRole('button', { name: /save platforms/i }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/recap/handles',
        expect.objectContaining({ body: JSON.stringify({ youtube: 'creator', tiktok: '', instagram: '' }) })
      )
    );
    await waitFor(() => expect(screen.getByRole('button', { name: /generate this month/i })).toBeInTheDocument());
  });

  it('does not show the generate button when a save leaves every platform blank', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ handles: { youtube: 'creator', tiktok: null, instagram: null }, recapCardId: null }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<RecapPage />);
    await waitFor(() => screen.getByRole('button', { name: /generate this month/i }));
    fireEvent.change(screen.getByLabelText(/youtube channel handle/i), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /save platforms/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /generate this month/i })).not.toBeInTheDocument()
    );
  });

  it('offers a sign-in prompt instead of a dead end when the visitor is signed out', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: 'You must be signed in.' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<RecapPage />);
    await waitFor(() => expect(screen.getByLabelText('Email')).toBeInTheDocument());
    expect(screen.queryByLabelText(/youtube channel handle/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'creator@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send sign-in link/i }));

    await waitFor(() => expect(screen.getByText(/check your email/i)).toHaveTextContent('creator@example.com'));
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/auth/magic-link',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'creator@example.com', redirectPath: '/recap' }),
      })
    );
  });

  it('shows an error when saving handles fails to reach the server', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ handles: { youtube: null, tiktok: null, instagram: null }, recapCardId: null }),
      })
      .mockRejectedValueOnce(new Error('network error'));
    vi.stubGlobal('fetch', fetchMock);

    render(<RecapPage />);
    await waitFor(() => screen.getByLabelText(/youtube channel handle/i));
    fireEvent.change(screen.getByLabelText(/youtube channel handle/i), { target: { value: 'creator' } });
    fireEvent.click(screen.getByRole('button', { name: /save platforms/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/couldn't reach the server/i)
    );
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
