// tests/unit/app/home/page.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: () => '/home',
  useRouter: () => ({ push: pushMock }),
}));

// Per the ruling in Task 10: <AppNav>'s independent fetch('/api/session')
// call is not safely inert against a host page's own fetch mock. This
// file's mock happens to be a persistent mockResolvedValue (not an ordered
// queue), so it's not actually at risk the way Tasks 10-12's files were —
// but mocking AppNav out here too keeps the pattern consistent and removes
// any future fragility if this test file's mocks ever change shape.
// AppNav's own behavior is already fully covered by its dedicated suite.
vi.mock('@/components/AppNav', () => ({
  AppNav: () => null,
}));

import HomePage from '@/app/home/page';

function homeResponse(overrides: Record<string, unknown> = {}) {
  return {
    email: 'jordan@example.com',
    diagnostic: null,
    recap: null,
    ideas: { niche: null, digest: null },
    ...overrides,
  };
}

describe('HomePage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    pushMock.mockClear();
  });

  it('shows a prompt-to-act card for every section with no data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => homeResponse() }));
    render(<HomePage />);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Run your first diagnostic' })).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: "Generate this month's recap" })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Set your niche to get this week&apos;s ideas'.replace('&apos;', "'") })).toBeInTheDocument();
  });

  it('shows the latest diagnostic score when one exists', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () =>
          homeResponse({
            diagnostic: {
              id: 'diagnostic-1',
              platform: 'youtube',
              overallScore: 78,
              hookStrengthScore: 82,
              retentionRiskScore: 61,
              timingScore: 88,
              formatFitScore: 75,
              createdAt: '2026-08-13T00:00:00Z',
            },
          }),
      })
    );
    render(<HomePage />);
    await waitFor(() => expect(screen.getByText('78')).toBeInTheDocument());
    expect(screen.getByText('/100')).toBeInTheDocument();
  });

  it('shows the recap stat and top post when a card exists for this month', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () =>
          homeResponse({
            recap: {
              id: 'card-1',
              month: '2026-08-01',
              totals: { views: 142000, likes: 4000, comments: 300, postCount: 5 },
              platformData: { youtube: { views: 100000, likes: 3000, comments: 200, postCount: 3 } },
              topPost: { platform: 'youtube', captionOrTitle: '3 Editing Tricks I Wish I Knew Sooner', viewCount: 38000, permalink: 'https://example.com' },
              generatedAt: '2026-08-01T00:00:00Z',
            },
          }),
      })
    );
    render(<HomePage />);
    await waitFor(() => expect(screen.getByText('142K')).toBeInTheDocument());
    expect(screen.getByText(/3 Editing Tricks I Wish I Knew Sooner/)).toBeInTheDocument();
  });

  it('shows a "set your niche" prompt when no niche is set', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => homeResponse() }));
    render(<HomePage />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Set my niche' })).toBeInTheDocument()
    );
  });

  it('shows a "get this week\'s ideas" prompt when a niche is set but nothing is generated yet', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => homeResponse({ ideas: { niche: 'home baking', digest: null } }) })
    );
    render(<HomePage />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Get my ideas' })).toBeInTheDocument());
  });

  it('shows the idea teaser when this week already has a digest', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () =>
          homeResponse({
            ideas: { niche: 'home baking', digest: { weekStart: '2026-08-10', ideaCount: 3, firstIdeaTitle: 'Sourdough Speedrun' } },
          }),
      })
    );
    render(<HomePage />);
    await waitFor(() => expect(screen.getByText('Sourdough Speedrun')).toBeInTheDocument());
    expect(screen.getByText('+2 more')).toBeInTheDocument();
  });

  it('shows the hero welcome message derived from the email', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => homeResponse({ email: 'jordan@example.com' }) }));
    render(<HomePage />);
    await waitFor(() => expect(screen.getByText('Welcome back, Jordan.')).toBeInTheDocument());
  });

  it('redirects to / when the bootstrap fetch is unauthorized', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'unauthorized' }) }));
    render(<HomePage />);
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/'));
  });
});
