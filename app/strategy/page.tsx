'use client';

import { useEffect, useReducer, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AppNav } from '@/components/AppNav';
import { Spinner } from '@/components/Spinner';
import { SignInPrompt } from '@/components/SignInPrompt';
import { UpgradePrompt } from '@/components/UpgradePrompt';
import { strategyPageReducer, createInitialStrategyPageState } from '@/lib/strategy/page-state';

export default function StrategyPage() {
  const router = useRouter();
  const [state, dispatch] = useReducer(strategyPageReducer, createInitialStrategyPageState());
  const stillWorkingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/strategy')
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401) {
          dispatch({ type: 'BOOTSTRAP_UNAUTHORIZED' });
          return;
        }
        if (res.status === 402) {
          dispatch({ type: 'BOOTSTRAP_PAYMENT_REQUIRED' });
          return;
        }
        const data = await res.json();
        dispatch({ type: 'BOOTSTRAPPED', history: data.history ?? [] });
      })
      .catch(() => {
        if (!cancelled) dispatch({ type: 'BOOTSTRAP_FAILED' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (state.status !== 'submitting') return undefined;
    stillWorkingTimer.current = setTimeout(() => dispatch({ type: 'SUBMIT_STILL_WORKING' }), 8000);
    return () => {
      if (stillWorkingTimer.current) clearTimeout(stillWorkingTimer.current);
    };
  }, [state.status]);

  const redirectId = state.status === 'redirecting' ? state.id : undefined;
  useEffect(() => {
    if (redirectId) {
      router.push(`/strategy/${redirectId}`);
    }
  }, [redirectId, router]);

  async function submitUrl(url: string) {
    try {
      const response = await fetch('/api/strategy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await response.json();
      if (!response.ok) {
        dispatch({ type: 'SUBMIT_FAILED', error: data.error ?? 'Something went wrong. Please try again.' });
        return;
      }
      dispatch({ type: 'SUBMIT_SUCCESS', id: data.id });
    } catch {
      dispatch({
        type: 'SUBMIT_FAILED',
        error: "Something went wrong on our end. Try again in a moment — your attempt hasn't been used up.",
      });
    }
  }

  async function submitMagicLink(email: string) {
    try {
      const response = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, redirectPath: '/strategy' }),
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

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.status !== 'idle' && state.status !== 'submitFailed') return;
    const url = state.url;
    dispatch({ type: 'SUBMIT' });
    void submitUrl(url);
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
        <h1 className="text-2xl font-bold text-gray-900">Creator strategy breakdown</h1>
        <SignInPrompt
          state={state}
          introCopy="Sign in with a one-time email link to run a strategy breakdown."
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

  if (state.status === 'requiresUpgrade') {
    return (
      <>
        <AppNav />
        <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
          <h1 className="text-2xl font-bold text-gray-900">Creator strategy breakdown</h1>
          <UpgradePrompt
            title="Creator Strategy Breakdown is part of Creator Dashboard's paid plan"
            body="Paste any channel you admire and get a plain-English breakdown of their posting cadence, format mix, and why it's working, for $10/mo."
          />
        </main>
      </>
    );
  }

  return (
    <>
      <AppNav />
      <main className="mx-auto flex max-w-xl flex-col gap-6 px-6 py-16">
        <h1 className="text-2xl font-bold text-gray-900">Creator strategy breakdown</h1>
        <p className="text-gray-600">
          Paste a link to a YouTube, TikTok, or Instagram channel you admire — even one that isn&apos;t yours.
        </p>

        {(state.status === 'idle' || state.status === 'submitting' || state.status === 'submitFailed') && (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <label htmlFor="channel-url" className="text-sm font-medium text-gray-700">
              Channel or profile link
            </label>
            <input
              id="channel-url"
              name="channel-url"
              type="url"
              required
              value={state.url}
              onChange={(e) => dispatch({ type: 'URL_CHANGED', value: e.target.value })}
              disabled={state.status === 'submitting'}
              placeholder="https://www.youtube.com/@channel"
              className="rounded-lg border border-gray-300 px-4 py-2"
            />
            <button
              type="submit"
              disabled={state.status === 'submitting'}
              className="rounded-full bg-indigo-600 px-6 py-3 font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {state.status === 'submitting' ? (
                <Spinner label={state.stillWorking ? 'Still working — studying their recent posts…' : 'Analyzing…'} />
              ) : (
                'Break down this channel'
              )}
            </button>
            {state.status === 'submitFailed' && (
              <p role="alert" className="text-sm text-red-600">
                {state.error}
              </p>
            )}
          </form>
        )}

        {(state.status === 'idle' || state.status === 'submitting' || state.status === 'submitFailed') &&
          state.history.length > 0 && (
            <div className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold text-gray-900">Past breakdowns</h2>
              <ul className="flex flex-col gap-2">
                {state.history.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={`/strategy/${item.id}`}
                      className="flex flex-col gap-1 rounded-lg border border-gray-200 p-3 hover:border-indigo-300"
                    >
                      <span className="text-sm font-medium text-gray-900">{item.headline}</span>
                      <span className="text-xs text-gray-500">
                        {item.platform} · @{item.channelHandle}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

        {/* The router push is in flight; without this the page would sit on a
            bare heading with no sign anything is happening. Plain text rather
            than <Spinner>, whose ring is white-on-white outside a button. */}
        {state.status === 'redirecting' && (
          <p role="status" className="text-gray-600">
            Taking you to your breakdown…
          </p>
        )}
      </main>
    </>
  );
}
