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
});
