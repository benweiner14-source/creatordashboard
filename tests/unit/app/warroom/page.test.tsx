import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/components/AppNav', () => ({ AppNav: () => null }));

import WarroomPage from '@/app/warroom/page';

function alertsResponse(overrides: Record<string, unknown> = {}) {
  return {
    alerts: [
      {
        id: 'a1',
        platform: 'youtube',
        externalPostId: 'v1',
        url: 'https://example.com/v1',
        captionOrTitle: 'GTA 6 trailer breakdown',
        viewCount: 300000,
        engagementCount: 1000,
        publishedAt: '2026-09-15T10:00:00Z',
        severity: 'already_viral',
        detectedAt: '2026-09-15T11:00:00Z',
      },
    ],
    emailOptIn: false,
    ...overrides,
  };
}

describe('WarroomPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the sign-in prompt when the bootstrap fetch is unauthorized', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'unauthorized' }) }));
    render(<WarroomPage />);
    await waitFor(() => expect(screen.getByLabelText('Email')).toBeInTheDocument());
  });

  it('shows the upgrade prompt when the bootstrap fetch requires payment', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 402, json: async () => ({ error: 'payment required', upgradeUrl: '/billing' }) }));
    render(<WarroomPage />);
    // The page's 402 branch renders a static <UpgradePrompt>, not the fetched
    // error body (same pattern as /ideas and /strategy) — assert against
    // that component's own title text, not the discarded API error string.
    await waitFor(() => expect(screen.getByText(/is part of creator dashboard's paid plan/i)).toBeInTheDocument());
  });

  it('renders each alert with its severity and platform', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => alertsResponse() }));
    render(<WarroomPage />);
    await waitFor(() => expect(screen.getByText('GTA 6 trailer breakdown')).toBeInTheDocument());
    expect(screen.getByText(/already viral/i)).toBeInTheDocument();
  });

  it('shows the empty state when there are no alerts yet', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => alertsResponse({ alerts: [] }) }));
    render(<WarroomPage />);
    await waitFor(() => expect(screen.getByText(/no gta 6 alerts yet/i)).toBeInTheDocument());
  });

  it('builds a "Generate an idea from this" link carrying the alert caption as context', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => alertsResponse() }));
    render(<WarroomPage />);
    await waitFor(() => expect(screen.getByRole('link', { name: /generate an idea from this/i })).toBeInTheDocument());
    const link = screen.getByRole('link', { name: /generate an idea from this/i });
    expect(link).toHaveAttribute('href', `/ideas?context=${encodeURIComponent('GTA 6 trailer breakdown')}`);
  });

  it('toggles the email opt-in checkbox via POST /api/warroom/opt-in', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => alertsResponse() })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<WarroomPage />);
    const checkbox = await screen.findByRole('checkbox', { name: /email me when something crosses going viral/i });
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);

    expect(checkbox).toBeChecked();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/warroom/opt-in',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ optIn: true }) })
      )
    );
  });
});
