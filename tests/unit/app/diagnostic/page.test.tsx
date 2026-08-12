// tests/unit/app/diagnostic/page.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

import DiagnosticInputPage from '@/app/diagnostic/page';

describe('DiagnosticInputPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    pushMock.mockClear();
  });

  it('submits the pasted URL and navigates to the report page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'diagnostic-1', report: {} }) })
    );
    render(<DiagnosticInputPage />);
    fireEvent.change(screen.getByLabelText(/paste a youtube, tiktok, or instagram link/i), {
      target: { value: 'https://www.tiktok.com/@user/video/123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /get my report/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/diagnostic/diagnostic-1'));
  });

  it('shows an error message when the request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'You have already used your free diagnostic for this 30-day period.' }),
      })
    );
    render(<DiagnosticInputPage />);
    fireEvent.change(screen.getByLabelText(/paste a youtube, tiktok, or instagram link/i), {
      target: { value: 'https://www.tiktok.com/@user/video/123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /get my report/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('already used your free diagnostic'));
  });

  it('shows an error message when the network request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
    render(<DiagnosticInputPage />);
    fireEvent.change(screen.getByLabelText(/paste a youtube, tiktok, or instagram link/i), {
      target: { value: 'https://www.tiktok.com/@user/video/123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /get my report/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong. Please check your connection and try again.')
    );
  });
});
