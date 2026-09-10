// tests/unit/app/watchlist/page.test.tsx
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// AppNav calls usePathname()/useRouter() (not part of this page's own
// concerns) and makes its own independent fetch('/api/session') call that
// would race against this file's per-test fetch stubs. Mocking it out here
// matches every other page test in this codebase (home, ideas, recap,
// diagnostic, strategy) per the ruling in Task 10 — AppNav's own behavior
// is already covered by its dedicated suite.
vi.mock('@/components/AppNav', () => ({
  AppNav: () => null,
}));

import WatchlistPage from '@/app/watchlist/page';

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('WatchlistPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows a sign-in prompt when the bootstrap GET returns 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'You must be signed in.' }, 401)));
    render(<WatchlistPage />);
    await waitFor(() => expect(screen.getByLabelText(/email/i)).toBeInTheDocument());
  });

  it('renders existing entries after a successful bootstrap', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          entries: [
            {
              id: 'entry-1',
              platform: 'youtube',
              handle: 'creator',
              url: 'https://www.youtube.com/@creator',
              label: 'Main rival',
              lastError: null,
              hasSnapshot: true,
              subscriberCount: 4200,
              totalViewCount: 900000,
              videoCount: 150,
              topPosts: [{ captionOrTitle: 'A great video', url: 'https://youtu.be/x', viewCount: 5000, publishedAt: '2026-09-09T00:00:00Z', viewsPerHour: 200 }],
              sevenDayDelta: { subscriberDelta: 100, totalViewDelta: 5000, videoDelta: 1, comparedAgainstCapturedAt: '2026-09-03T00:00:00Z' },
              thirtyDayDelta: null,
            },
          ],
          subscriptionRequired: false,
        })
      )
    );
    render(<WatchlistPage />);
    await waitFor(() => expect(screen.getByText('Main rival')).toBeInTheDocument());
    expect(screen.getByText('4,200')).toBeInTheDocument();
  });

  it('shows the upgrade banner when subscriptionRequired is true', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ entries: [], subscriptionRequired: true })));
    render(<WatchlistPage />);
    await waitFor(() => expect(screen.getByText(/upgrade to keep this watchlist refreshed/i)).toBeInTheDocument());
  });

  it('disables the add form once the 20-competitor cap is reached', async () => {
    const entries = Array.from({ length: 20 }, (_, i) => ({
      id: `entry-${i}`,
      platform: 'youtube',
      handle: `creator${i}`,
      url: `https://www.youtube.com/@creator${i}`,
      label: null,
      lastError: null,
      hasSnapshot: false,
      subscriberCount: null,
      totalViewCount: null,
      videoCount: null,
      topPosts: [],
      sevenDayDelta: null,
      thirtyDayDelta: null,
    }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ entries, subscriptionRequired: false })));
    render(<WatchlistPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: /add competitor/i })).toBeDisabled());
  });

  describe('adding a competitor', () => {
    beforeEach(() => {
      let getCallCount = 0;
      const fetchMock = vi.fn((url: string, init?: RequestInit) => {
        if (url === '/api/watchlist' && (!init || init.method === undefined)) {
          getCallCount += 1;
          if (getCallCount === 1) {
            // Bootstrap GET: nothing tracked yet.
            return Promise.resolve(jsonResponse({ entries: [], subscriptionRequired: false }));
          }
          // Re-fetch GET after a successful POST: the freshly-added entry, in full.
          return Promise.resolve(
            jsonResponse({
              entries: [
                {
                  id: 'entry-new',
                  platform: 'youtube',
                  handle: 'freshcreator',
                  url: 'https://www.youtube.com/@freshcreator',
                  label: 'Fresh rival',
                  lastError: null,
                  hasSnapshot: false,
                  subscriberCount: null,
                  totalViewCount: null,
                  videoCount: null,
                  topPosts: [],
                  sevenDayDelta: null,
                  thirtyDayDelta: null,
                },
              ],
              subscriptionRequired: false,
            })
          );
        }
        if (url === '/api/watchlist' && init?.method === 'POST') {
          // Deliberately bare, unlike the full entry the re-fetch GET returns above — if the
          // page ever regressed to appending this response directly instead of re-fetching,
          // the assertions below (which look for data only the GET response carries) would fail.
          return Promise.resolve(jsonResponse({ entry: { id: 'entry-new' } }));
        }
        return Promise.resolve(jsonResponse({ error: 'unexpected call' }, 500));
      });
      vi.stubGlobal('fetch', fetchMock);
    });

    it('re-fetches the list after a successful add and renders the fresh entry, not the bare POST response', async () => {
      render(<WatchlistPage />);
      await waitFor(() => expect(screen.getByText(/no competitors tracked yet/i)).toBeInTheDocument());

      fireEvent.change(screen.getByLabelText(/channel or profile link/i), {
        target: { value: 'https://www.youtube.com/@freshcreator' },
      });
      fireEvent.click(screen.getByRole('button', { name: /add competitor/i }));

      await waitFor(() => expect(screen.getByText('Fresh rival')).toBeInTheDocument());
      // Only the re-fetched GET response carries this handle/platform text — the bare POST
      // response ({ entry: { id: 'entry-new' } }) has no handle or platform at all.
      expect(screen.getByText(/youtube · @freshcreator/i)).toBeInTheDocument();
    });

    it('shows an error and keeps the form usable when adding fails', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn((url: string, init?: RequestInit) => {
          if (init?.method === 'POST') {
            return Promise.resolve(jsonResponse({ error: 'That link is not supported.' }, 400));
          }
          return Promise.resolve(jsonResponse({ entries: [], subscriptionRequired: false }));
        })
      );
      render(<WatchlistPage />);
      await waitFor(() => expect(screen.getByLabelText(/channel or profile link/i)).toBeInTheDocument());

      fireEvent.change(screen.getByLabelText(/channel or profile link/i), { target: { value: 'https://example.com/x' } });
      fireEvent.click(screen.getByRole('button', { name: /add competitor/i }));

      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('That link is not supported.'));
    });
  });

  it('removes an entry from the list when the remove button succeeds', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        return Promise.resolve({ ok: true, status: 204, json: async () => ({}) });
      }
      return Promise.resolve(
        jsonResponse({
          entries: [
            {
              id: 'entry-1',
              platform: 'youtube',
              handle: 'creator',
              url: 'https://www.youtube.com/@creator',
              label: null,
              lastError: null,
              hasSnapshot: false,
              subscriberCount: null,
              totalViewCount: null,
              videoCount: null,
              topPosts: [],
              sevenDayDelta: null,
              thirtyDayDelta: null,
            },
          ],
          subscriptionRequired: false,
        })
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<WatchlistPage />);
    await waitFor(() => expect(screen.getByText('@creator')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    await waitFor(() => expect(screen.getByText(/no competitors tracked yet/i)).toBeInTheDocument());
  });

  it('shows an error and keeps the entry when the remove request fails', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        return Promise.resolve(jsonResponse({ error: 'Something went wrong removing that competitor.' }, 500));
      }
      return Promise.resolve(
        jsonResponse({
          entries: [
            {
              id: 'entry-1',
              platform: 'youtube',
              handle: 'creator',
              url: 'https://www.youtube.com/@creator',
              label: null,
              lastError: null,
              hasSnapshot: false,
              subscriberCount: null,
              totalViewCount: null,
              videoCount: null,
              topPosts: [],
              sevenDayDelta: null,
              thirtyDayDelta: null,
            },
          ],
          subscriptionRequired: false,
        })
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<WatchlistPage />);
    await waitFor(() => expect(screen.getByText('@creator')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /remove/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong removing that competitor.')
    );
    // The entry must still be shown — REMOVE_FAILED should not remove it from the list.
    expect(screen.getByText('@creator')).toBeInTheDocument();
  });

  it('shows an entry-level error message instead of stats when lastError is set', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          entries: [
            {
              id: 'entry-1',
              platform: 'youtube',
              handle: 'creator',
              url: 'https://www.youtube.com/@creator',
              label: null,
              lastError: "We couldn't find this channel anymore — it may have been renamed or removed.",
              hasSnapshot: false,
              subscriberCount: null,
              totalViewCount: null,
              videoCount: null,
              topPosts: [],
              sevenDayDelta: null,
              thirtyDayDelta: null,
            },
          ],
          subscriptionRequired: false,
        })
      )
    );
    render(<WatchlistPage />);
    await waitFor(() => expect(screen.getByText(/renamed or removed/i)).toBeInTheDocument());
  });
});
