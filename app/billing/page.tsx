'use client';

import { useEffect, useReducer, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppNav } from '@/components/AppNav';
import { Banner } from '@/components/Banner';
import { Spinner } from '@/components/Spinner';
import { SignInPrompt } from '@/components/SignInPrompt';
import { UpgradePrompt } from '@/components/UpgradePrompt';
import { billingPageReducer, createInitialBillingPageState } from '@/lib/billing/page-state';
import type { BillingStatusData } from '@/lib/billing/page-state';
import { formatDateInTimezone } from '@/lib/format/timezone';

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
            dispatch({ type: 'BOOTSTRAPPED', data, justSubscribed: true });
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
        <main className="mx-auto flex max-w-[560px] flex-col gap-[22px] px-6 py-11">
          <h1 className="font-heading text-[34px] font-bold leading-[1.05] text-gray-900">Billing</h1>
          <Spinner variant="onLight" label={state.status === 'polling' ? 'Finishing up…' : 'Loading…'} />
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
        <main className="mx-auto flex max-w-[560px] flex-col gap-[22px] px-6 py-11">
          <h1 className="font-heading text-[34px] font-bold leading-[1.05] text-gray-900">Billing</h1>
          <Banner variant="critical" label="Couldn't load" role="alert">
            We couldn&apos;t load your billing status. Please refresh and try again.
          </Banner>
        </main>
      </>
    );
  }

  return (
    <>
      <AppNav />
      <main className="mx-auto flex max-w-[560px] flex-col gap-[22px] px-6 py-11">
        <div>
          <div className="mb-2 font-mono text-[11px] uppercase tracking-[.2em] text-gray-500">Account</div>
          <h1 className="font-heading text-[34px] font-bold leading-[1.05] text-gray-900">Billing</h1>
        </div>

        {state.status === 'free' && (
          <>
            {state.justCheckedOut && (
              <Banner variant="caution" label="Processing">
                Payment received — this can take a minute to reflect. Refresh to check again.
              </Banner>
            )}
            <UpgradePrompt title="You're on the free plan" body="Upgrade to unlock Recap Card and Weekly Content Ideas.">
              <div className="flex flex-col gap-2.5">
                {['Recap Card', 'Weekly Content Ideas'].map((feature) => (
                  <div key={feature} className="flex items-center gap-2.5 text-sm text-gray-700">
                    <span
                      aria-hidden="true"
                      className="flex h-5 w-5 flex-none items-center justify-center rounded-md bg-[#ede9fe] text-xs font-bold text-[#6d28d9]"
                    >
                      ✓
                    </span>
                    {feature}
                  </div>
                ))}
              </div>
            </UpgradePrompt>
          </>
        )}

        {state.status === 'subscribed' && (
          <>
            {state.justSubscribed && (
              <div className="flex items-center gap-3 rounded-[14px] border border-[#a7f3d0] border-t-2 border-t-[#10b981] bg-gradient-to-br from-[#ecfdf5] to-[#d1fae5] px-[18px] py-4">
                <span
                  aria-hidden="true"
                  className="motion-safe:animate-pop flex h-[34px] w-[34px] flex-none items-center justify-center rounded-full bg-[#10b981] text-base font-bold text-white"
                >
                  ✓
                </span>
                <div className="flex flex-col gap-0.5">
                  <span className="font-mono text-[11px] uppercase tracking-[.14em] text-[#047857]">You&apos;re in</span>
                  <p className="text-sm leading-[1.45] text-[#1f2937]">Recap Card and Weekly Content Ideas are unlocked.</p>
                </div>
              </div>
            )}
            <div className="flex flex-col gap-4 rounded-[18px] border border-[#e8e8ee] bg-white px-7 py-[26px] shadow-[0_1px_2px_rgba(17,24,39,.04)]">
              <span
                className={`inline-flex w-fit whitespace-nowrap rounded-full border px-3 py-1 font-mono text-[11px] uppercase tracking-[.14em] ${
                  state.pastDue
                    ? 'border-[#fecaca] bg-[#fee2e2] text-[#b91c1c]'
                    : state.cancelAtPeriodEnd
                      ? 'border-[#fde68a] bg-[#fef3c7] text-[#b45309]'
                      : 'border-[#a7f3d0] bg-[#d1fae5] text-[#047857]'
                }`}
              >
                {state.pastDue ? 'Action needed' : state.cancelAtPeriodEnd ? 'Ending soon' : 'Active'}
              </span>
              {state.pastDue && (
                <Banner variant="critical" label="Payment failed" role="alert">
                  We couldn&apos;t process your last payment — please update your card.
                </Banner>
              )}
              {/* When a payment has failed and the plan isn't already ending,
                  the stored period end is the period whose renewal just
                  failed — showing it alongside the payment warning would
                  contradict it, so suppress the line entirely. */}
              {!(state.pastDue && !state.cancelAtPeriodEnd) && (
                <p className="text-base text-gray-700">
                  {state.cancelAtPeriodEnd
                    ? state.currentPeriodEnd
                      ? `Your plan ends ${formatDateInTimezone(state.currentPeriodEnd, state.timezone, { month: 'long', day: 'numeric' })}.`
                      : 'Your plan is ending soon.'
                    : state.currentPeriodEnd
                      ? `You're subscribed — renews ${formatDateInTimezone(state.currentPeriodEnd, state.timezone, { month: 'long', day: 'numeric' })}.`
                      : "You're subscribed."}
                </p>
              )}
              <button
                type="button"
                onClick={managePlan}
                disabled={managingPlan}
                className="self-start whitespace-nowrap rounded-full border border-[#7c3aed] px-[22px] py-[11px] text-sm font-semibold text-[#6d28d9] disabled:opacity-50"
              >
                {managingPlan ? 'Redirecting…' : 'Manage plan'}
              </button>
              {manageError && (
                <p role="alert" className="text-[13px] text-[#b91c1c]">
                  {manageError}
                </p>
              )}
            </div>
          </>
        )}
      </main>
    </>
  );
}
