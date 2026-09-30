import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

// AppNav makes its own fetch('/api/session') call on mount; not relevant to
// this page's own content, and its behavior is covered by its own suite.
vi.mock('@/components/AppNav', () => ({
  AppNav: () => null,
}));

import SettingsPage from '@/app/settings/page';

describe('SettingsPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    pushMock.mockClear();
  });

  it('shows a sign-in prompt instead of a dead end when the visitor is signed out', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 401, json: async () => ({ error: 'unauthorized' }) }));
    render(<SettingsPage />);
    await waitFor(() => expect(screen.getByLabelText('Email')).toBeInTheDocument());
  });

  it('shows every section once signed in', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200, json: async () => ({ email: 'creator@example.com' }) }));
    render(<SettingsPage />);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument());
    expect(screen.getAllByText('Profile').length).toBeGreaterThan(0);
    expect(screen.getByText('Login & security')).toBeInTheDocument();
    expect(screen.getByText('Connected platforms')).toBeInTheDocument();
    expect(screen.getByText('Notifications & email')).toBeInTheDocument();
    expect(screen.getByText('Timezone & locale')).toBeInTheDocument();
    expect(screen.getByText('Billing & subscription')).toBeInTheDocument();
    expect(screen.getAllByText('Delete account').length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/^email$/i)).toHaveValue('creator@example.com');
  });

  it('shows an error message when the settings fetch fails outright', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
    render(<SettingsPage />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("couldn't load your settings"));
  });

  it('enrolls and verifies two-factor authentication for real', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/session') return Promise.resolve({ status: 200, json: async () => ({ email: 'creator@example.com' }) });
      if (url === '/api/settings/platforms') return Promise.resolve({ ok: true, json: async () => ({ tiktok: false, instagram: false, youtube: false }) });
      if (url === '/api/settings/mfa/factors') return Promise.resolve({ ok: true, json: async () => ({ factorId: null }) });
      if (url === '/api/settings/mfa/enroll') {
        return Promise.resolve({ ok: true, json: async () => ({ factorId: 'factor-1', qrCode: '<svg></svg>', secret: 'ABC123' }) });
      }
      if (url === '/api/settings/mfa/verify') return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<SettingsPage />);
    fireEvent.click(await screen.findByRole('switch', { name: 'Two-factor authentication' }));

    await waitFor(() => expect(screen.getByLabelText(/verification code/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/verification code/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/settings/mfa/verify',
        expect.objectContaining({ body: JSON.stringify({ factorId: 'factor-1', code: '123456' }) })
      )
    );
    expect(await screen.findByRole('switch', { name: 'Two-factor authentication' })).toHaveAttribute('aria-checked', 'true');
  });

  it('loads real connection status and disconnects a connected platform for real', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ status: 200, json: async () => ({ email: 'creator@example.com' }) })
      .mockResolvedValueOnce({ status: 200, json: async () => ({ displayName: null }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ tiktok: true, instagram: false, youtube: false }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ factorId: null }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<SettingsPage />);
    await waitFor(() => expect(screen.getByText('Connected')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /^disconnect$/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith('/api/oauth/tiktok/disconnect', { method: 'POST' })
    );
    // instagram and youtube already read "Not connected"; tiktok joining them
    // after a real disconnect brings the count to three.
    await waitFor(() => expect(screen.getAllByText('Not connected')).toHaveLength(3));
  });

  it('links Connect to the real OAuth authorize endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url === '/api/session') return Promise.resolve({ status: 200, json: async () => ({ email: 'creator@example.com' }) });
        return Promise.resolve({ ok: true, json: async () => ({ tiktok: false, instagram: false, youtube: false }) });
      })
    );

    render(<SettingsPage />);
    await waitFor(() => expect(screen.getAllByText('Not connected').length).toBeGreaterThan(0));

    const connectLinks = screen.getAllByRole('link', { name: /^connect$/i });
    expect(connectLinks[0]).toHaveAttribute('href', expect.stringMatching(/^\/api\/oauth\/(tiktok|instagram)\/authorize$/));
  });

  it('saves a YouTube handle', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ status: 200, json: async () => ({ email: 'creator@example.com' }) })
      .mockResolvedValueOnce({ status: 200, json: async () => ({ displayName: null }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ tiktok: false, instagram: false, youtube: false }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ factorId: null }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<SettingsPage />);
    const input = await screen.findByLabelText(/youtube handle/i);
    fireEvent.change(input, { target: { value: '@creator' } });
    fireEvent.blur(input);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/settings/platforms/youtube',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ handle: '@creator' }) })
      )
    );
  });

  it('arms and cancels the delete-account confirmation without deleting anything', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200, json: async () => ({ email: 'creator@example.com' }) }));
    render(<SettingsPage />);
    await waitFor(() => screen.getByRole('button', { name: 'Delete account' }));

    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    expect(screen.getByText(/isn't available yet/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText(/isn't available yet/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete account' })).toBeInTheDocument();
  });

  it('signs out and redirects home when Sign out is clicked', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ status: 200, json: async () => ({ email: 'creator@example.com' }) })
      .mockResolvedValueOnce({ status: 200, json: async () => ({ displayName: null }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ tiktok: false, instagram: false, youtube: false }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ factorId: null }) })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    render(<SettingsPage />);
    await waitFor(() => screen.getByRole('button', { name: 'Sign out' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/'));
    expect(fetchMock).toHaveBeenLastCalledWith('/api/auth/sign-out', { method: 'POST' });
  });

  it('saves the display name on blur', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ status: 200, json: async () => ({ email: 'creator@example.com' }) })
      .mockResolvedValueOnce({ status: 200, json: async () => ({ displayName: null }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ tiktok: false, instagram: false, youtube: false }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ factorId: null }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<SettingsPage />);
    const input = await screen.findByLabelText('Display name');
    fireEvent.change(input, { target: { value: 'Jordan' } });
    fireEvent.blur(input);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/settings/profile',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ displayName: 'Jordan' }) })
      )
    );
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  it('loads persisted display name on page load, overriding the email-derived default', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ status: 200, json: async () => ({ email: 'creator@example.com' }) })
      .mockResolvedValueOnce({ status: 200, json: async () => ({ displayName: 'Jordan' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ tiktok: false, instagram: false, youtube: false }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ factorId: null }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<SettingsPage />);
    const input = await screen.findByLabelText('Display name');

    await waitFor(() => {
      expect((input as HTMLInputElement).value).toBe('Jordan');
    });
  });

  it('shows a confirmation message after changing the email', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ status: 200, json: async () => ({ email: 'creator@example.com' }) })
      .mockResolvedValueOnce({ status: 200, json: async () => ({ displayName: null }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ tiktok: false, instagram: false, youtube: false }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ factorId: null }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'confirmationSent' }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<SettingsPage />);
    const input = await screen.findByLabelText(/^email$/i);
    fireEvent.change(input, { target: { value: 'new@example.com' } });
    fireEvent.blur(input);

    expect(await screen.findByText(/check your new inbox/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/settings/email',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ email: 'new@example.com' }) })
    );
  });

  it('saves the timezone on change', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ status: 200, json: async () => ({ email: 'creator@example.com' }) })
      .mockResolvedValueOnce({ status: 200, json: async () => ({ displayName: null }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ tiktok: false, instagram: false, youtube: false }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ factorId: null }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<SettingsPage />);
    const select = await screen.findByLabelText(/^timezone$/i);
    fireEvent.change(select, { target: { value: 'Europe/London' } });

    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/settings/locale',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ timezone: 'Europe/London' }) })
      )
    );
  });
});
