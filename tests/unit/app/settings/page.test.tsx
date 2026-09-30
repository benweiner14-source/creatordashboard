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

  it('toggles two-factor authentication locally without claiming it is enforced', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200, json: async () => ({ email: 'creator@example.com' }) }));
    render(<SettingsPage />);
    await waitFor(() => screen.getByRole('switch', { name: 'Two-factor authentication' }));

    const toggle = screen.getByRole('switch', { name: 'Two-factor authentication' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/not yet enforced at sign-in/i)).toBeInTheDocument();
  });

  it('toggles a platform connection locally', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200, json: async () => ({ email: 'creator@example.com' }) }));
    render(<SettingsPage />);
    await waitFor(() => screen.getByText('Connected platforms'));

    const connectButtons = screen.getAllByRole('button', { name: /^connect$/i });
    fireEvent.click(connectButtons[0]);
    expect(screen.getAllByRole('button', { name: /^disconnect$/i }).length).toBeGreaterThan(0);
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
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    render(<SettingsPage />);
    await waitFor(() => screen.getByRole('button', { name: 'Sign out' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/'));
    expect(fetchMock).toHaveBeenLastCalledWith('/api/auth/sign-out', { method: 'POST' });
  });
});
