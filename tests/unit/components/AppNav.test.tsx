// tests/unit/components/AppNav.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: () => '/home',
  useRouter: () => ({ push: pushMock }),
}));

import { AppNav } from '@/components/AppNav';

describe('AppNav', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    pushMock.mockClear();
  });

  it('renders nothing while the session check is pending', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const { container } = render(<AppNav />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the session check returns 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }));
    const { container } = render(<AppNav />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('shows identity and highlights the active link once signed in', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ email: 'jordan@example.com' }) }));
    render(<AppNav />);
    await waitFor(() => expect(screen.getByText('jordan@example.com')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Diagnostic' })).not.toHaveAttribute('aria-current');
  });

  it('calls sign-out then navigates home when Sign out is clicked', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/session') return Promise.resolve({ ok: true, json: async () => ({ email: 'jordan@example.com' }) });
      return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AppNav />);
    await waitFor(() => expect(screen.getByText('jordan@example.com')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/auth/sign-out', { method: 'POST' }));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/'));
  });

  it('stays put instead of navigating when sign-out fails', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/session') return Promise.resolve({ ok: true, json: async () => ({ email: 'jordan@example.com' }) });
      return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'nope' }) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AppNav />);
    await waitFor(() => expect(screen.getByText('jordan@example.com')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/auth/sign-out', { method: 'POST' }));
    // The cookie is still valid, so pushing to '/' would bounce the user
    // straight back to /home and look like the sign-out succeeded.
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('does not navigate when the sign-out request itself rejects', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/session') return Promise.resolve({ ok: true, json: async () => ({ email: 'jordan@example.com' }) });
      return Promise.reject(new Error('offline'));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AppNav />);
    await waitFor(() => expect(screen.getByText('jordan@example.com')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/auth/sign-out', { method: 'POST' }));
    expect(pushMock).not.toHaveBeenCalled();
  });

  // Below the `sm` breakpoint the nav link row collapses by design. If the
  // sign-out control collapsed with it, a signed-in mobile user would have no
  // way out at all — `/` redirects them straight back to /home. jsdom has no
  // real viewport, so the check is structural: no ancestor of the button may
  // carry a responsive `hidden` class.
  it('keeps the sign-out button outside every responsively-hidden wrapper', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ email: 'jordan@example.com' }) }));
    const { container } = render(<AppNav />);
    await waitFor(() => expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument());

    const button = screen.getByRole('button', { name: /sign out/i });
    for (let node: HTMLElement | null = button; node && node !== container; node = node.parentElement) {
      expect(Array.from(node.classList)).not.toContain('hidden');
    }
  });
});
