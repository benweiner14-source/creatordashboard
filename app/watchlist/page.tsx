'use client';

import { useEffect, useReducer, useRef } from 'react';
import { AppNav } from '@/components/AppNav';
import { Spinner } from '@/components/Spinner';
import { SignInPrompt } from '@/components/SignInPrompt';
import { watchlistPageReducer, createInitialWatchlistPageState, WATCHLIST_ENTRY_LIMIT } from '@/lib/watchlist/page-state';
import type { WatchlistEntryView } from '@/lib/watchlist/types';

export default function WatchlistPage() {
  const [state, dispatch] = useReducer(watchlistPageReducer, createInitialWatchlistPageState());
  const stillWorkingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmounted = useRef(false);
  // Entry ids a background refresh has already been started for, so a re-render
  // or a post-add list re-fetch never asks the server to refresh one twice.
  const refreshAttempted = useRef<Set<string>>(new Set());
  // Serialises every refresh pass (bootstrap's and the one after an add) into a
  // single chain, so "one refresh at a time" holds even if a creator adds a
  // competitor while the bootstrap pass is still working through the backlog.
  const refreshChain = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    // Reset on (re-)mount as well as setting it on unmount: React's dev-mode
    // double-invoke runs the cleanup between the two effect passes, and a
    // latched `true` would silently kill every background refresh in dev.
    unmounted.current = false;
    return () => {
      unmounted.current = true;
    };
  }, []);

  /**
   * GET /api/watchlist is read-only, so anything past its TTL arrives stale.
   * Refresh those one at a time in the background — sequentially, not in
   * parallel, to stay gentle on the shared daily refresh budget and on the
   * upstream APIs — merging each entry into the list as its response lands.
   * Nothing here blocks the render; a failed refresh is silently left alone
   * (the entry keeps showing its cached numbers and will retry next visit).
   */
  async function refreshStaleEntries(entries: WatchlistEntryView[], subscriptionRequired: boolean) {
    if (subscriptionRequired) return; // Refreshing is the paid action; a 402 is guaranteed.
    for (const entry of entries) {
      if (!entry.isStale || refreshAttempted.current.has(entry.id)) continue;
      refreshAttempted.current.add(entry.id);
      try {
        const response = await fetch('/api/watchlist/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entryId: entry.id }),
        });
        if (unmounted.current) return;
        if (!response.ok) continue;
        const data = await response.json();
        if (data?.entry && !unmounted.current) {
          dispatch({ type: 'REFRESH_ENTRY_SUCCESS', entry: data.entry });
        }
      } catch {
        // Non-blocking by design: leave the cached row as it is.
      }
    }
  }

  function queueStaleRefreshes(entries: WatchlistEntryView[], subscriptionRequired: boolean) {
    refreshChain.current = refreshChain.current.then(() => refreshStaleEntries(entries, subscriptionRequired)).catch(() => {});
  }

  useEffect(() => {
    let cancelled = false;
    fetch('/api/watchlist')
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401) {
          dispatch({ type: 'BOOTSTRAP_UNAUTHORIZED' });
          return;
        }
        const data = await res.json();
        const entries: WatchlistEntryView[] = data.entries ?? [];
        const subscriptionRequired: boolean = data.subscriptionRequired ?? false;
        dispatch({ type: 'BOOTSTRAPPED', entries, subscriptionRequired });
        queueStaleRefreshes(entries, subscriptionRequired);
      })
      .catch(() => {
        if (!cancelled) dispatch({ type: 'BOOTSTRAP_FAILED' });
      });
    return () => {
      cancelled = true;
    };
    // Bootstrap runs exactly once on mount. queueStaleRefreshes closes over
    // refs only, so re-running this effect when it is re-created would just
    // re-issue the bootstrap GET for no reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isAdding = state.status === 'loaded' && state.adding;
  useEffect(() => {
    if (!isAdding) return undefined;
    stillWorkingTimer.current = setTimeout(() => dispatch({ type: 'ADD_STILL_WORKING' }), 8000);
    return () => {
      if (stillWorkingTimer.current) clearTimeout(stillWorkingTimer.current);
    };
  }, [isAdding]);

  async function submitAdd(url: string, label: string) {
    try {
      const response = await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, label: label || undefined }),
      });
      const data = await response.json();
      if (!response.ok) {
        dispatch({ type: 'ADD_FAILED', error: data.error ?? 'Something went wrong. Please try again.' });
        return;
      }
      const refreshed = await fetch('/api/watchlist');
      const refreshedData = await refreshed.json();
      const entries: WatchlistEntryView[] = refreshedData.entries ?? [];
      const subscriptionRequired: boolean = refreshedData.subscriptionRequired ?? false;
      dispatch({ type: 'ADD_SUCCESS', entries, subscriptionRequired });
      // The entry just added has no snapshot yet, so it comes back stale —
      // fetch its first snapshot in the background, same as on bootstrap.
      queueStaleRefreshes(entries, subscriptionRequired);
    } catch {
      dispatch({ type: 'ADD_FAILED', error: 'Something went wrong on our end. Try again in a moment.' });
    }
  }

  async function submitRemove(entryId: string) {
    try {
      const response = await fetch(`/api/watchlist/${entryId}`, { method: 'DELETE' });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        dispatch({ type: 'REMOVE_FAILED', error: data.error ?? 'Something went wrong removing that competitor.' });
        return;
      }
      dispatch({ type: 'REMOVE_SUCCESS', entryId });
    } catch {
      dispatch({ type: 'REMOVE_FAILED', error: "We couldn't reach the server. Check your connection and try again." });
    }
  }

  async function submitMagicLink(email: string) {
    try {
      const response = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, redirectPath: '/watchlist' }),
      });
      const data = await response.json();
      if (!response.ok) {
        dispatch({ type: 'MAGIC_LINK_FAILED', error: data.error ?? 'Something went wrong. Please try again.' });
        return;
      }
      dispatch({ type: 'MAGIC_LINK_SENT' });
    } catch {
      dispatch({ type: 'MAGIC_LINK_FAILED', error: "We couldn't reach the server. Check your connection and try again." });
    }
  }

  function handleAddSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.status !== 'loaded' || state.adding) return;
    const { addUrl, addLabel } = state;
    dispatch({ type: 'ADD_SUBMIT' });
    void submitAdd(addUrl, addLabel);
  }

  if (state.status === 'loading') {
    return <p>Loading…</p>;
  }

  if (
    state.status === 'needsSignIn' ||
    state.status === 'submittingMagicLink' ||
    state.status === 'checkEmail' ||
    state.status === 'magicLinkError'
  ) {
    return (
      <main className="mx-auto flex max-w-md flex-col gap-6 px-6 py-16">
        <h1 className="text-2xl font-bold text-gray-900">Competitor watchlist</h1>
        <SignInPrompt
          state={state}
          introCopy="Sign in with a one-time email link to build your competitor watchlist."
          returnCopy="Click it to continue and we'll bring you right back here."
          onEmailChange={(email) => dispatch({ type: 'EMAIL_CHANGED', email })}
          onSubmitEmail={() => {
            const { email } = state;
            dispatch({ type: 'SUBMIT_EMAIL' });
            void submitMagicLink(email);
          }}
          onResend={() => {
            const { email } = state;
            dispatch({ type: 'RESEND_EMAIL' });
            void submitMagicLink(email);
          }}
          onRetryEmail={() => dispatch({ type: 'RETRY_EMAIL' })}
        />
      </main>
    );
  }

  const atCap = state.entries.length >= WATCHLIST_ENTRY_LIMIT;

  return (
    <>
      <AppNav />
      <main className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-16">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Competitor watchlist</h1>
          <p className="mt-1 text-gray-600">
            Track up to {WATCHLIST_ENTRY_LIMIT} channels you&apos;re competing with — subscribers, views, and their
            best-performing posts.
          </p>
        </div>

        {state.subscriptionRequired && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Upgrade to keep this watchlist refreshed.{' '}
            <a href="/billing" className="font-semibold underline">
              See plans
            </a>
          </div>
        )}

        <form onSubmit={handleAddSubmit} className="flex flex-col gap-3 rounded-lg border border-gray-200 p-4 sm:flex-row sm:items-end">
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor="competitor-url" className="text-sm font-medium text-gray-700">
              Channel or profile link
            </label>
            <input
              id="competitor-url"
              type="url"
              required
              value={state.addUrl}
              onChange={(e) => dispatch({ type: 'ADD_URL_CHANGED', value: e.target.value })}
              disabled={state.adding || atCap}
              placeholder="https://www.youtube.com/@channel"
              className="rounded-lg border border-gray-300 px-3 py-2"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="competitor-label" className="text-sm font-medium text-gray-700">
              Label (optional)
            </label>
            <input
              id="competitor-label"
              type="text"
              value={state.addLabel}
              onChange={(e) => dispatch({ type: 'ADD_LABEL_CHANGED', value: e.target.value })}
              disabled={state.adding || atCap}
              placeholder="Main rival"
              className="rounded-lg border border-gray-300 px-3 py-2"
            />
          </div>
          <button
            type="submit"
            disabled={state.adding || atCap}
            title={atCap ? `You've reached the ${WATCHLIST_ENTRY_LIMIT}-competitor limit.` : undefined}
            className="rounded-full bg-indigo-600 px-5 py-2 font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {state.adding ? <Spinner label={state.addStillWorking ? 'Still checking their channel…' : 'Adding…'} /> : 'Add competitor'}
          </button>
        </form>
        {state.bootstrapError && (
          <p role="alert" className="text-sm text-red-600">
            {state.bootstrapError}
          </p>
        )}
        {state.addError && (
          <p role="alert" className="text-sm text-red-600">
            {state.addError}
          </p>
        )}
        {state.removeError && (
          <p role="alert" className="text-sm text-red-600">
            {state.removeError}
          </p>
        )}

        {state.entries.length === 0 ? (
          <p className="text-gray-500">No competitors tracked yet — add a channel above to get started.</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {state.entries.map((entry) => (
              <li key={entry.id} className="rounded-lg border border-gray-200 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-semibold text-gray-900">{entry.label || `@${entry.handle}`}</p>
                    <p className="text-xs text-gray-500">
                      {entry.platform} · @{entry.handle}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      dispatch({ type: 'REMOVE_REQUESTED', entryId: entry.id });
                      void submitRemove(entry.id);
                    }}
                    disabled={state.removingEntryId === entry.id}
                    className="text-xs text-gray-400 hover:text-red-600 disabled:opacity-50"
                  >
                    {state.removingEntryId === entry.id ? 'Removing…' : 'Remove'}
                  </button>
                </div>

                {/* A failed refresh annotates the row; it never blanks it. An
                    entry's last good snapshot is still the truest thing we know
                    about that competitor, so the numbers stay put. */}
                {entry.lastError && <p className="mt-2 text-sm text-amber-700">{entry.lastError}</p>}

                {!entry.hasSnapshot ? (
                  <p className="mt-2 text-sm text-gray-500">Fetching first snapshot…</p>
                ) : (
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <Stat
                      label="Subscribers"
                      value={entry.subscriberCount}
                      sevenDayDelta={entry.sevenDayDelta?.subscriberDelta ?? null}
                      thirtyDayDelta={entry.thirtyDayDelta?.subscriberDelta ?? null}
                      sevenDayBaseline={entry.sevenDayDelta?.comparedAgainstCapturedAt ?? null}
                      thirtyDayBaseline={entry.thirtyDayDelta?.comparedAgainstCapturedAt ?? null}
                    />
                    {/* For TikTok/Instagram, total views and post count are a sum
                        over a rolling ~50-post window, not lifetime totals — a
                        delta on them measures the window sliding, not growth, so
                        the badges are suppressed (the raw figure still shows). */}
                    <Stat
                      label="Total views"
                      value={entry.totalViewCount}
                      sevenDayDelta={entry.platform === 'youtube' ? entry.sevenDayDelta?.totalViewDelta ?? null : null}
                      thirtyDayDelta={entry.platform === 'youtube' ? entry.thirtyDayDelta?.totalViewDelta ?? null : null}
                      sevenDayBaseline={entry.sevenDayDelta?.comparedAgainstCapturedAt ?? null}
                      thirtyDayBaseline={entry.thirtyDayDelta?.comparedAgainstCapturedAt ?? null}
                    />
                    <Stat
                      label="Videos"
                      value={entry.videoCount}
                      sevenDayDelta={entry.platform === 'youtube' ? entry.sevenDayDelta?.videoDelta ?? null : null}
                      thirtyDayDelta={entry.platform === 'youtube' ? entry.thirtyDayDelta?.videoDelta ?? null : null}
                      sevenDayBaseline={entry.sevenDayDelta?.comparedAgainstCapturedAt ?? null}
                      thirtyDayBaseline={entry.thirtyDayDelta?.comparedAgainstCapturedAt ?? null}
                    />
                  </div>
                )}

                {entry.hasSnapshot && entry.topPosts.length > 0 && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm font-medium text-indigo-700">View top posts</summary>
                    <ul className="mt-2 flex flex-col gap-2">
                      {entry.topPosts.map((post) => (
                        <li key={post.url} className="text-sm text-gray-700">
                          <a href={post.url} className="underline hover:text-indigo-700" target="_blank" rel="noreferrer">
                            {post.captionOrTitle}
                          </a>{' '}
                          <span className="text-gray-500">— {Math.round(post.viewsPerHour).toLocaleString()} views/hr</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}

/**
 * A delta's baseline is "the most recent snapshot at least N days old", which
 * can be considerably older than N days when an entry was added a while ago and
 * refreshed rarely. Labelling every 7-day delta "this week" overstated that;
 * naming the actual comparison date is both honest and no less readable.
 */
function formatBaselineDate(capturedAt: string): string {
  const date = new Date(capturedAt);
  if (!Number.isFinite(date.getTime())) return 'earlier';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function DeltaBadge({ delta, baseline }: { delta: number; baseline: string | null }) {
  return (
    <span className={`block text-sm font-normal ${delta >= 0 ? 'text-green-600' : 'text-red-600'}`}>
      {delta >= 0 ? '+' : ''}
      {delta.toLocaleString()}
      {baseline ? ` since ${formatBaselineDate(baseline)}` : ''}
    </span>
  );
}

function Stat({
  label,
  value,
  sevenDayDelta,
  thirtyDayDelta,
  sevenDayBaseline,
  thirtyDayBaseline,
}: {
  label: string;
  value: number | null;
  sevenDayDelta: number | null;
  thirtyDayDelta: number | null;
  sevenDayBaseline: string | null;
  thirtyDayBaseline: string | null;
}) {
  // With little history the ">=7 days old" and ">=30 days old" lookups often
  // land on the same snapshot; showing the identical badge twice would just
  // read as a rendering bug.
  const showThirtyDay = thirtyDayDelta !== null && thirtyDayBaseline !== sevenDayBaseline;
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-lg font-semibold text-gray-900">{value === null ? '—' : value.toLocaleString()}</p>
      {sevenDayDelta !== null && <DeltaBadge delta={sevenDayDelta} baseline={sevenDayBaseline} />}
      {showThirtyDay && <DeltaBadge delta={thirtyDayDelta} baseline={thirtyDayBaseline} />}
    </div>
  );
}
