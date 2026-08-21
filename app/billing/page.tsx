'use client';

import { useEffect, useReducer, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppNav } from '@/components/AppNav';
import { SignInPrompt } from '@/components/SignInPrompt';
import { UpgradePrompt } from '@/components/UpgradePrompt';
import { billingPageReducer, createInitialBillingPageState } from '@/lib/billing/page-state';
import type { BillingStatusData } from '@/lib/billing/page-state';

const POLL_ATTEMPTS = 4;
const POLL_DELAY_MS = 1500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function BillingPage() {
  const router = useRouter();
  const [state, dispatch] = useReducer(billingPageReducer, createInitialBillingPageState());
  const [managingPlan, setManagingPlan] = useState(false);
  const [manageError, setManageError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchStatus(): Promise<BillingStatusData | 'unauthorized' | null> {
      const res = await fetch('/api/billing/status');
      if (res.status === 401) return 'unauthorized';
      const data = await res.json();
      if (data.error) return null;
      return data as BillingStatusData;
    }

    async function bootstrap() {
      const isCheckoutSuccess = new URLSearchParams(window.location.search).get('checkout') === 'success';

      if (isCheckoutSuccess) {
        dispatch({ type: 'START_POLLING' });
        for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
          const data = await fetchStatus();
          if (cancelled) return;
          if (data === 'unauthorized') {
            dispatch({ type: 'BOOTSTRAP_UNAUTHORIZED' });
            return;
          }
          if (data === null) {
            dispatch({ type: 'BOOTSTRAP_FAILED' });
            return;
          }
          if (data.status !== 'free') {
            dispatch({ type: 'BOOTSTRAPPED', data });
            // Strip ?checkout=success so a refresh doesn't re-run polling.
            // Deliberately not done on the exhausted path — keeping the
            // param there means a manual refresh retries the poll.
            router.replace('/billing');
            return;
          }
          if (attempt < POLL_ATTEMPTS - 1) await sleep(POLL_DELAY_MS);
        }
        if (!cancelled) dispatch({ type: 'POLL_EXHAUSTED' });
        return;
      }

      const data = await fetchStatus();
      if (cancelled) return;
      if (data === 'unauthorized') {
        dispatch({ type: 'BOOTSTRAP_UNAUTHORIZED' });
        return;
      }
      if (data === null) {
        dispatch({ type: 'BOOTSTRAP_FAILED' });
        return;
      }
      dispatch({ type: 'BOOTSTRAPPED', data });
    }

    bootstrap().catch(() => {
      if (!cancelled) dispatch({ type: 'BOOTSTRAP_FAILED' });
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function submitMagicLink(email: string) {
    try {
      const response = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, redirectPath: '/billing' }),
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

  async function managePlan() {
    setManagingPlan(true);
    setManageError(null);
    try {
      const res = await fetch('/api/billing/portal', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.url) {
        setManageError(data.error ?? 'Something went wrong opening your plan settings.');
        setManagingPlan(false);
        return;
      }
      window.location.href = data.url;
    } catch {
      setManageError("We couldn't reach the server. Check your connection and try again.");
      setManagingPlan(false);
    }
  }

  if (state.status === 'loading' || state.status === 'polling') {
    return (
      <>
        <AppNav />
        <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
          <h1 className="text-2xl font-bold text-gray-900">Billing</h1>
          <p>{state.status === 'polling' ? 'Finishing up…' : 'Loading…'}</p>
        </main>
      </>
    );
  }

  if (
    state.status === 'needsSignIn' ||
    state.status === 'submittingMagicLink' ||
    state.status === 'checkEmail' ||
    state.status === 'magicLinkError'
  ) {
    return (
      <main className="mx-auto flex max-w-md flex-col gap-6 px-6 py-16">
        <h1 className="text-2xl font-bold text-gray-900">Billing</h1>
        <SignInPrompt
          state={state}
          introCopy="Sign in with a one-time email link to manage your plan."
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

  if (state.status === 'bootstrapFailed') {
    return (
      <>
        <AppNav />
        <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
          <h1 className="text-2xl font-bold text-gray-900">Billing</h1>
          <p role="alert">We couldn&apos;t load your billing status. Please refresh and try again.</p>
        </main>
      </>
    );
  }

  return (
    <>
      <AppNav />
      <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
        <h1 className="text-2xl font-bold text-gray-900">Billing</h1>

        {state.status === 'free' && (
          <>
            {state.justCheckedOut && (
              <p className="rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-800">
                Payment received — this can take a minute to reflect. Refresh to check again.
              </p>
            )}
            <UpgradePrompt
              title="You're on the free plan"
              body="Upgrade to unlock Recap Card and Weekly Content Ideas."
            />
          </>
        )}

        {state.status === 'subscribed' && (
          <div className="flex flex-col gap-4 rounded-lg border border-gray-200 p-6">
            {state.pastDue && (
              <p role="alert" className="text-sm text-red-600">
                We couldn&apos;t process your last payment — please update your card.
              </p>
            )}
            {/* When a payment has failed and the plan isn't already ending,
                the stored period end is the period whose renewal just
                failed — showing it alongside the payment warning would
                contradict it, so suppress the line entirely. */}
            {!(state.pastDue && !state.cancelAtPeriodEnd) && (
              <p className="text-gray-700">
                {state.cancelAtPeriodEnd
                  ? state.currentPeriodEnd
                    ? `Your plan ends ${new Date(state.currentPeriodEnd).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}.`
                    : 'Your plan is ending soon.'
                  : state.currentPeriodEnd
                    ? `You're subscribed — renews ${new Date(state.currentPeriodEnd).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}.`
                    : "You're subscribed."}
              </p>
            )}
            <button
              type="button"
              onClick={managePlan}
              disabled={managingPlan}
              className="self-start rounded-full border border-indigo-600 px-6 py-3 font-semibold text-indigo-700 disabled:opacity-50"
            >
              {managingPlan ? 'Redirecting…' : 'Manage plan'}
            </button>
            {manageError && (
              <p role="alert" className="text-sm text-red-600">
                {manageError}
              </p>
            )}
          </div>
        )}
      </main>
    </>
  );
}
