'use client';

import { useEffect, useReducer, useRef } from 'react';
import { AppNav } from '@/components/AppNav';
import { Spinner } from '@/components/Spinner';
import { SignInPrompt } from '@/components/SignInPrompt';
import { watchlistPageReducer, createInitialWatchlistPageState, WATCHLIST_ENTRY_LIMIT } from '@/lib/watchlist/page-state';

export default function WatchlistPage() {
  const [state, dispatch] = useReducer(watchlistPageReducer, createInitialWatchlistPageState());
  const stillWorkingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        dispatch({ type: 'BOOTSTRAPPED', entries: data.entries ?? [], subscriptionRequired: data.subscriptionRequired ?? false });
      })
      .catch(() => {
        if (!cancelled) dispatch({ type: 'BOOTSTRAP_FAILED' });
      });
    return () => {
      cancelled = true;
    };
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
      dispatch({
        type: 'ADD_SUCCESS',
        entries: refreshedData.entries ?? [],
        subscriptionRequired: refreshedData.subscriptionRequired ?? false,
      });
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

                {entry.lastError ? (
                  <p className="mt-2 text-sm text-amber-700">{entry.lastError}</p>
                ) : !entry.hasSnapshot ? (
                  <p className="mt-2 text-sm text-gray-500">Fetching first snapshot…</p>
                ) : (
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <Stat label="Subscribers" value={entry.subscriberCount} delta={entry.sevenDayDelta?.subscriberDelta ?? null} />
                    <Stat label="Total views" value={entry.totalViewCount} delta={entry.sevenDayDelta?.totalViewDelta ?? null} />
                    <Stat label="Videos" value={entry.videoCount} delta={entry.sevenDayDelta?.videoDelta ?? null} />
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

function Stat({ label, value, delta }: { label: string; value: number | null; delta: number | null }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-lg font-semibold text-gray-900">
        {value === null ? '—' : value.toLocaleString()}
        {delta !== null && (
          <span className={`ml-2 text-sm font-normal ${delta >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {delta >= 0 ? '+' : ''}
            {delta.toLocaleString()} this week
          </span>
        )}
      </p>
    </div>
  );
}
