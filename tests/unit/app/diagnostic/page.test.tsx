// tests/unit/app/diagnostic/page.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const pushMock = vi.fn();
let mockSearchParams = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => mockSearchParams,
}));

import DiagnosticInputPage from '@/app/diagnostic/page';

describe('DiagnosticInputPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    pushMock.mockClear();
    mockSearchParams = new URLSearchParams();
  });

  it('submits the pasted URL and navigates to the report page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'diagnostic-1' }) }));
    render(<DiagnosticInputPage />);
    fireEvent.change(screen.getByLabelText(/paste a youtube, tiktok, or instagram link/i), {
      target: { value: 'https://www.tiktok.com/@user/video/123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /get my report/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/diagnostic/diagnostic-1'));
  });

  it('shows the inline sign-in prompt on a 401 and preserves the pasted URL', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'You must be signed in to run a diagnostic.' }) })
    );
    render(<DiagnosticInputPage />);
    fireEvent.change(screen.getByLabelText(/paste a youtube, tiktok, or instagram link/i), {
      target: { value: 'https://www.tiktok.com/@user/video/123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /get my report/i }));

    await waitFor(() => expect(screen.getByText(/checking:/i)).toHaveTextContent('https://www.tiktok.com/@user/video/123'));
  });

  it('submits the email from the sign-in prompt and shows the check-your-email confirmation', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: 'You must be signed in to run a diagnostic.' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<DiagnosticInputPage />);
    fireEvent.change(screen.getByLabelText(/paste a youtube, tiktok, or instagram link/i), {
      target: { value: 'https://www.tiktok.com/@user/video/123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /get my report/i }));
    await waitFor(() => screen.getByLabelText('Email'));

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'creator@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send sign-in link/i }));

    await waitFor(() => expect(screen.getByText(/check your email/i)).toHaveTextContent('creator@example.com'));
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/auth/magic-link',
      expect.objectContaining({
        body: JSON.stringify({
          email: 'creator@example.com',
          redirectPath: `/diagnostic?url=${encodeURIComponent('https://www.tiktok.com/@user/video/123')}`,
        }),
      })
    );
  });

  it('shows an error message and preserves the url when the diagnostic request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({ error: 'You have already used your free diagnostic for this 30-day period.' }) })
    );
    render(<DiagnosticInputPage />);
    fireEvent.change(screen.getByLabelText(/paste a youtube, tiktok, or instagram link/i), {
      target: { value: 'https://www.tiktok.com/@user/video/123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /get my report/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('already used your free diagnostic'));
    expect(screen.getByLabelText(/paste a youtube, tiktok, or instagram link/i)).toHaveValue('https://www.tiktok.com/@user/video/123');
  });

  it('shows an error message when the diagnostic request throws a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
    render(<DiagnosticInputPage />);
    fireEvent.change(screen.getByLabelText(/paste a youtube, tiktok, or instagram link/i), {
      target: { value: 'https://www.tiktok.com/@user/video/123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /get my report/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("your link hasn't been used up"));
  });

  it('pre-fills the url from ?url= on mount without auto-submitting', () => {
    mockSearchParams = new URLSearchParams('url=' + encodeURIComponent('https://www.tiktok.com/@user/video/123'));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<DiagnosticInputPage />);

    expect(screen.getByLabelText(/paste a youtube, tiktok, or instagram link/i)).toHaveValue('https://www.tiktok.com/@user/video/123');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lands directly in the sign-in prompt with a notice when returning from an expired magic link', () => {
    mockSearchParams = new URLSearchParams(
      'url=' + encodeURIComponent('https://www.tiktok.com/@user/video/123') + '&authError=expired'
    );
    render(<DiagnosticInputPage />);

    expect(screen.getByText(/expired or was already used/i)).toBeInTheDocument();
    expect(screen.getByText(/checking:/i)).toHaveTextContent('https://www.tiktok.com/@user/video/123');
  });
});
