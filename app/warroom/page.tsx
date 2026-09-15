'use client';

import { useEffect, useReducer } from 'react';
import { AppNav } from '@/components/AppNav';
import { SignInPrompt } from '@/components/SignInPrompt';
import { UpgradePrompt } from '@/components/UpgradePrompt';
import { warroomPageReducer, createInitialWarroomPageState } from '@/lib/warroom/page-state';
import type { WarroomAlertRow } from '@/lib/warroom/types';

const SEVERITY_LABELS: Record<WarroomAlertRow['severity'], string> = {
  heating_up: '🔥 Heating Up',
  going_viral: '🚀 Going Viral',
  already_viral: '💥 Already Viral',
};

export default function WarroomPage() {
  const [state, dispatch] = useReducer(warroomPageReducer, createInitialWarroomPageState());

  useEffect(() => {
    let cancelled = false;
    fetch('/api/warroom')
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
        if (data.error) {
          dispatch({ type: 'BOOTSTRAP_FAILED' });
          return;
        }
        dispatch({ type: 'BOOTSTRAPPED', alerts: data.alerts ?? [], emailOptIn: data.emailOptIn ?? false });
      })
      .catch(() => {
        if (!cancelled) dispatch({ type: 'BOOTSTRAP_FAILED' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function submitMagicLink(email: string) {
    try {
      const response = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, redirectPath: '/warroom' }),
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

  async function toggleOptIn(optIn: boolean) {
    if (state.status !== 'loaded') return;
    const previousValue = state.emailOptIn;
    dispatch({ type: 'OPT_IN_TOGGLED', optIn });
    try {
      const res = await fetch('/api/warroom/opt-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ optIn }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        dispatch({ type: 'OPT_IN_SAVE_FAILED', previousValue, error: data.error ?? 'Something went wrong saving that.' });
      }
    } catch {
      dispatch({
        type: 'OPT_IN_SAVE_FAILED',
        previousValue,
        error: "We couldn't reach the server. Check your connection and try again.",
      });
    }
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
        <h1 className="text-2xl font-bold text-gray-900">GTA 6 War Room</h1>
        <SignInPrompt
          state={state}
          introCopy="Sign in with a one-time email link to see what's trending in GTA 6 right now."
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
          <h1 className="text-2xl font-bold text-gray-900">GTA 6 War Room</h1>
          <UpgradePrompt
            title="GTA 6 War Room is part of Creator Dashboard's paid plan"
            body="See what's trending in GTA 6 right now, across YouTube, TikTok, and Instagram, for $10/mo."
          />
        </main>
      </>
    );
  }

  if (state.status === 'bootstrapFailed') {
    return (
      <>
        <AppNav />
        <p role="alert">We couldn&apos;t load the War Room. Please refresh and try again.</p>
      </>
    );
  }

  return (
    <>
      <AppNav />
      <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
        <h1 className="text-2xl font-bold text-gray-900">GTA 6 War Room</h1>
        <p className="text-gray-600">What&apos;s trending in GTA 6 right now, across YouTube, TikTok, and Instagram.</p>

        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={state.emailOptIn}
            onChange={(e) => toggleOptIn(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300"
          />
          Email me when something crosses Going Viral
        </label>
        {state.optInError && (
          <p role="alert" className="text-sm text-red-600">
            {state.optInError}
          </p>
        )}

        {state.alerts.length === 0 ? (
          <p className="text-gray-500">No GTA 6 alerts yet — check back soon.</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {state.alerts.map((alert) => (
              <li key={alert.id} className="rounded-lg border border-gray-200 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{SEVERITY_LABELS[alert.severity]}</span>
                  <span className="text-xs uppercase text-gray-400">{alert.platform}</span>
                </div>
                <p className="mt-1 text-gray-900">{alert.captionOrTitle}</p>
                <p className="mt-1 text-xs text-gray-500">
                  {alert.viewCount.toLocaleString()} views · {alert.engagementCount.toLocaleString()} engagement
                </p>
                <div className="mt-2 flex gap-4 text-sm">
                  <a href={alert.url} target="_blank" rel="noreferrer" className="text-indigo-700 underline">
                    View post
                  </a>
                  <a href={`/ideas?context=${encodeURIComponent(alert.captionOrTitle)}`} className="text-indigo-700 underline">
                    Generate an idea from this
                  </a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
