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
              isStale: false,
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
      isStale: false,
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
                  isStale: false,
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
              isStale: false,
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
              isStale: false,
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

  it('keeps showing the last good stats when lastError is set, rendering the error as a note above them', async () => {
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
              lastError: "Couldn't refresh this competitor's stats. Will retry next visit.",
              hasSnapshot: true,
              isStale: false,
              subscriberCount: 4200,
              totalViewCount: 900000,
              videoCount: 150,
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
    await waitFor(() => expect(screen.getByText(/will retry next visit/i)).toBeInTheDocument());
    // A several-day-old snapshot is still the truest thing we know — the error
    // annotates the row, it does not blank it.
    expect(screen.getByText('4,200')).toBeInTheDocument();
    expect(screen.getByText('900,000')).toBeInTheDocument();
    expect(screen.queryByText(/fetching first snapshot/i)).not.toBeInTheDocument();
  });

  it('labels delta badges with the real comparison date and renders the 30-day delta too', async () => {
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
              lastError: null,
              hasSnapshot: true,
              isStale: false,
              subscriberCount: 4200,
              totalViewCount: 900000,
              videoCount: 150,
              topPosts: [],
              sevenDayDelta: { subscriberDelta: 200, totalViewDelta: 5000, videoDelta: 1, comparedAgainstCapturedAt: '2026-09-03T00:00:00Z' },
              thirtyDayDelta: { subscriberDelta: 900, totalViewDelta: 40000, videoDelta: 6, comparedAgainstCapturedAt: '2026-08-11T00:00:00Z' },
            },
          ],
          subscriptionRequired: false,
        })
      )
    );
    render(<WatchlistPage />);
    await waitFor(() => expect(screen.getByText('+200 since Sep 3')).toBeInTheDocument());
    expect(screen.getByText('+900 since Aug 11')).toBeInTheDocument();
    // Never the old hard-coded "this week", which lied whenever the baseline
    // snapshot was much older than 7 days.
    expect(screen.queryByText(/this week/i)).not.toBeInTheDocument();
  });

  it('suppresses the windowed total-views/videos deltas for scraped platforms, keeping the follower delta', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          entries: [
            {
              id: 'entry-1',
              platform: 'tiktok',
              handle: 'creator',
              url: 'https://www.tiktok.com/@creator',
              label: null,
              lastError: null,
              hasSnapshot: true,
              isStale: false,
              subscriberCount: 42000,
              totalViewCount: 900000,
              videoCount: 30,
              topPosts: [],
              sevenDayDelta: { subscriberDelta: 1200, totalViewDelta: -50000, videoDelta: -2, comparedAgainstCapturedAt: '2026-09-03T00:00:00Z' },
              thirtyDayDelta: null,
            },
          ],
          subscriptionRequired: false,
        })
      )
    );
    render(<WatchlistPage />);
    await waitFor(() => expect(screen.getByText('+1,200 since Sep 3')).toBeInTheDocument());
    // total_view_count/video_count are a rolling ~50-post window for TikTok and
    // Instagram, so a "delta" on them measures the window sliding, not growth.
    expect(screen.queryByText('-50,000 since Sep 3')).not.toBeInTheDocument();
    expect(screen.queryByText('-2 since Sep 3')).not.toBeInTheDocument();
    expect(screen.getByText('900,000')).toBeInTheDocument();
  });

  it('surfaces an explicit error when the bootstrap GET fails, rather than looking like an empty watchlist', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    render(<WatchlistPage />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/couldn't load your watchlist/i));
  });

  describe('suggested creators', () => {
    it('shows suggested GTA6 creator quick-add chips when the list is empty', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ entries: [], subscriptionRequired: false })));
      render(<WatchlistPage />);
      await waitFor(() => expect(screen.getByText(/suggested gta6 creators to track/i)).toBeInTheDocument());
      expect(screen.getByRole('button', { name: /nought/i })).toBeInTheDocument();
    });

    it('hides the suggested creators section once there is at least one entry', async () => {
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
                isStale: false,
                subscriberCount: 4200,
                totalViewCount: 900000,
                videoCount: 150,
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
      await waitFor(() => expect(screen.getByText('Main rival')).toBeInTheDocument());
      expect(screen.queryByText(/suggested gta6 creators to track/i)).not.toBeInTheDocument();
    });

    it('clicking a suggested creator adds it via the same POST flow as the manual form', async () => {
      let getCallCount = 0;
      const fetchMock = vi.fn((url: string, init?: RequestInit) => {
        if (url === '/api/watchlist' && (!init || init.method === undefined)) {
          getCallCount += 1;
          if (getCallCount === 1) {
            return Promise.resolve(jsonResponse({ entries: [], subscriptionRequired: false }));
          }
          return Promise.resolve(
            jsonResponse({
              entries: [
                {
                  id: 'entry-nought',
                  platform: 'youtube',
                  handle: 'NoughtPointFourLIVE',
                  url: 'https://www.youtube.com/@NoughtPointFourLIVE',
                  label: 'Nought',
                  lastError: null,
                  hasSnapshot: false,
                  isStale: false,
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
          return Promise.resolve(jsonResponse({ entry: { id: 'entry-nought' } }));
        }
        return Promise.resolve(jsonResponse({ error: 'unexpected call' }, 500));
      });
      vi.stubGlobal('fetch', fetchMock);

      render(<WatchlistPage />);
      await waitFor(() => expect(screen.getByRole('button', { name: /nought/i })).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: /nought/i }));

      await waitFor(() => expect(screen.getByText(/youtube · @noughtpointfourlive/i)).toBeInTheDocument());
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/watchlist',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ url: 'https://www.youtube.com/@NoughtPointFourLIVE', label: 'Nought' }),
        })
      );
    });
  });

  describe('background refresh of stale entries', () => {
    function staleEntry(id: string, handle: string) {
      return {
        id,
        platform: 'youtube',
        handle,
        url: `https://www.youtube.com/@${handle}`,
        label: null,
        lastError: null,
        hasSnapshot: false,
        isStale: true,
        subscriberCount: null,
        totalViewCount: null,
        videoCount: null,
        topPosts: [],
        sevenDayDelta: null,
        thirtyDayDelta: null,
      };
    }

    it('POSTs one refresh per stale entry, sequentially, and merges each result in place', async () => {
      const refreshBodies: string[] = [];
      let inFlight = 0;
      let sawOverlap = false;

      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/api/watchlist/refresh') {
          inFlight += 1;
          if (inFlight > 1) sawOverlap = true;
          const { entryId } = JSON.parse(String(init?.body));
          refreshBodies.push(entryId);
          await Promise.resolve();
          inFlight -= 1;
          return jsonResponse({
            entry: {
              ...staleEntry(entryId, entryId === 'entry-1' ? 'alpha' : 'beta'),
              hasSnapshot: true,
              isStale: false,
              subscriberCount: entryId === 'entry-1' ? 1111 : 2222,
              totalViewCount: 10,
              videoCount: 1,
            },
            refreshed: true,
          });
        }
        return jsonResponse({ entries: [staleEntry('entry-1', 'alpha'), staleEntry('entry-2', 'beta')], subscriptionRequired: false });
      });
      vi.stubGlobal('fetch', fetchMock);

      render(<WatchlistPage />);

      // Cached rows render immediately, without waiting on any refresh.
      await waitFor(() => expect(screen.getByText('@alpha')).toBeInTheDocument());

      await waitFor(() => expect(screen.getByText('1,111')).toBeInTheDocument());
      await waitFor(() => expect(screen.getByText('2,222')).toBeInTheDocument());
      expect(refreshBodies).toEqual(['entry-1', 'entry-2']);
      expect(sawOverlap).toBe(false);
    });

    it('does not refresh entries that are already fresh', async () => {
      const fetchMock = vi.fn(async (url: string) => {
        if (url === '/api/watchlist/refresh') return jsonResponse({ entry: null, refreshed: false });
        return jsonResponse({
          entries: [{ ...staleEntry('entry-1', 'alpha'), isStale: false, hasSnapshot: true, subscriberCount: 500, totalViewCount: 9, videoCount: 1 }],
          subscriptionRequired: false,
        });
      });
      vi.stubGlobal('fetch', fetchMock);

      render(<WatchlistPage />);
      await waitFor(() => expect(screen.getByText('500')).toBeInTheDocument());
      expect(fetchMock.mock.calls.every(([url]) => url !== '/api/watchlist/refresh')).toBe(true);
    });

    it('does not attempt refreshes at all for an unsubscribed profile', async () => {
      const fetchMock = vi.fn(async (url: string) => {
        if (url === '/api/watchlist/refresh') return jsonResponse({ error: 'nope' }, 402);
        return jsonResponse({ entries: [staleEntry('entry-1', 'alpha')], subscriptionRequired: true });
      });
      vi.stubGlobal('fetch', fetchMock);

      render(<WatchlistPage />);
      await waitFor(() => expect(screen.getByText(/upgrade to keep this watchlist refreshed/i)).toBeInTheDocument());
      expect(fetchMock.mock.calls.every(([url]) => url !== '/api/watchlist/refresh')).toBe(true);
    });

    it('leaves the cached row untouched when a background refresh fails', async () => {
      const fetchMock = vi.fn(async (url: string) => {
        if (url === '/api/watchlist/refresh') return jsonResponse({ error: 'boom' }, 500);
        return jsonResponse({
          entries: [{ ...staleEntry('entry-1', 'alpha'), hasSnapshot: true, subscriberCount: 777, totalViewCount: 9, videoCount: 1 }],
          subscriptionRequired: false,
        });
      });
      vi.stubGlobal('fetch', fetchMock);

      render(<WatchlistPage />);
      await waitFor(() => expect(screen.getByText('777')).toBeInTheDocument());
      await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === '/api/watchlist/refresh')).toBe(true));
      // Still rendered, no error surfaced: a failed background refresh is not
      // the user's problem.
      expect(screen.getByText('777')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  it('shows the fetching-first-snapshot message for an entry that has never been fetched', async () => {
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
              isStale: false,
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
    // No snapshot has ever landed, so there are no stats to preserve — the
    // error note and the fetching message sit together.
    expect(screen.getByText(/fetching first snapshot/i)).toBeInTheDocument();
  });
});
