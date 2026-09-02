import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

// AppNav calls usePathname() (not part of this page's own concerns) and
// makes its own independent fetch('/api/session') call that would race
// against this file's per-test fetch stubs. Mocking it out here matches
// every other page test in this codebase (home, ideas, recap, diagnostic) —
// AppNav's own behavior is already covered by its dedicated suite.
vi.mock('@/components/AppNav', () => ({
  AppNav: () => null,
}));

import StrategyPage from '@/app/strategy/page';

describe('StrategyPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    pushMock.mockClear();
  });

  it('shows a sign-in prompt when bootstrap returns 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 401, ok: false, json: async () => ({ error: 'nope' }) }));
    render(<StrategyPage />);
    await waitFor(() => expect(screen.getByLabelText(/email/i)).toBeInTheDocument());
  });

  it('shows an upgrade prompt when bootstrap returns 402', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 402, ok: false, json: async () => ({ error: 'nope' }) }));
    render(<StrategyPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: /upgrade/i })).toBeInTheDocument());
  });

  it('shows the input form when bootstrap succeeds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => ({ ok: true }) }));
    render(<StrategyPage />);
    await waitFor(() => expect(screen.getByLabelText(/channel or profile link/i)).toBeInTheDocument());
  });

  it('submits the URL and redirects to the report page on success', async () => {
    const fetchMock = vi.fn((url: string, options?: RequestInit) => {
      if (!options) return Promise.resolve({ status: 200, ok: true, json: async () => ({ ok: true }) });
      return Promise.resolve({ status: 200, ok: true, json: async () => ({ id: 'strategy-1' }) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<StrategyPage />);
    await waitFor(() => expect(screen.getByLabelText(/channel or profile link/i)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/channel or profile link/i), { target: { value: 'https://youtube.com/@creator' } });
    fireEvent.click(screen.getByRole('button', { name: /break down this channel/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/strategy/strategy-1'));
  });

  it('shows an inline error when generation fails', async () => {
    const fetchMock = vi.fn((url: string, options?: RequestInit) => {
      if (!options) return Promise.resolve({ status: 200, ok: true, json: async () => ({ ok: true }) });
      return Promise.resolve({ status: 429, ok: false, json: async () => ({ error: "You've hit today's limit." }) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<StrategyPage />);
    await waitFor(() => expect(screen.getByLabelText(/channel or profile link/i)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/channel or profile link/i), { target: { value: 'https://youtube.com/@creator' } });
    fireEvent.click(screen.getByRole('button', { name: /break down this channel/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("hit today's limit"));
  });
});
