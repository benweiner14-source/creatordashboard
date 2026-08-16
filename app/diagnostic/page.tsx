// app/diagnostic/page.tsx
'use client';

import { Suspense, useEffect, useReducer, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AppNav } from '@/components/AppNav';
import { Spinner } from '@/components/Spinner';
import { SignInPrompt } from '@/components/SignInPrompt';
import { signInFlowReducer, createInitialSignInFlowState } from '@/lib/auth/sign-in-flow-state';

function DiagnosticInputPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, dispatch] = useReducer(
    signInFlowReducer,
    undefined,
    () =>
      createInitialSignInFlowState({
        url: searchParams.get('url') ?? undefined,
        authError: searchParams.get('authError') ?? undefined,
      })
  );
  const stillWorkingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (state.status === 'submittingDiagnostic') {
      stillWorkingTimer.current = setTimeout(() => dispatch({ type: 'DIAGNOSTIC_STILL_WORKING' }), 8000);
      return () => clearTimeout(stillWorkingTimer.current);
    }
  }, [state.status]);

  const redirectDiagnosticId = state.status === 'redirectingToReport' ? state.diagnosticId : undefined;
  useEffect(() => {
    if (redirectDiagnosticId) {
      router.push(`/diagnostic/${redirectDiagnosticId}`);
    }
  }, [redirectDiagnosticId, router]);

  async function submitDiagnostic(url: string) {
    try {
      const response = await fetch('/api/diagnostic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await response.json();
      if (response.status === 401) {
        dispatch({ type: 'DIAGNOSTIC_UNAUTHORIZED' });
        return;
      }
      if (!response.ok) {
        dispatch({ type: 'DIAGNOSTIC_FAILED', error: data.error ?? 'Something went wrong. Please try again.' });
        return;
      }
      dispatch({ type: 'DIAGNOSTIC_SUCCESS', diagnosticId: data.id });
    } catch {
      dispatch({
        type: 'DIAGNOSTIC_FAILED',
        error:
          "Something went wrong on our end generating your report. Try again in a moment — your link hasn't been used up.",
      });
    }
  }

  async function submitMagicLink(email: string, url: string) {
    try {
      const response = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, redirectPath: `/diagnostic?url=${encodeURIComponent(url)}` }),
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

  function handleDiagnosticSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.status !== 'idle' && state.status !== 'diagnosticError') return;
    const url = state.url;
    dispatch({ type: 'SUBMIT_DIAGNOSTIC' });
    void submitDiagnostic(url);
  }

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-6 py-16">
      <AppNav />
      <h1 className="text-2xl font-bold text-gray-900">Run a diagnostic</h1>

      {(state.status === 'idle' || state.status === 'submittingDiagnostic' || state.status === 'diagnosticError') && (
        <form onSubmit={handleDiagnosticSubmit} className="flex flex-col gap-4">
          <label htmlFor="url" className="text-sm font-medium text-gray-700">
            Paste a YouTube, TikTok, or Instagram link
          </label>
          <input
            id="url"
            name="url"
            type="url"
            required
            value={state.url}
            onChange={(e) => dispatch({ type: 'URL_CHANGED', url: e.target.value })}
            disabled={state.status === 'submittingDiagnostic'}
            placeholder="https://www.tiktok.com/@you/video/..."
            className="rounded-lg border border-gray-300 px-4 py-2"
          />
          <button
            type="submit"
            disabled={state.status === 'submittingDiagnostic'}
            className="rounded-full bg-indigo-600 px-6 py-3 font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {state.status === 'submittingDiagnostic' ? (
              <Spinner
                label={
                  state.stillWorking
                    ? "Still working — checking your video's stats and putting the report together…"
                    : 'Analyzing…'
                }
              />
            ) : (
              'Get my report'
            )}
          </button>
          {state.status === 'diagnosticError' && (
            <p role="alert" className="text-sm text-red-600">
              {state.error}
            </p>
          )}
        </form>
      )}

      {(state.status === 'needsSignIn' ||
        state.status === 'submittingMagicLink' ||
        state.status === 'checkEmail' ||
        state.status === 'magicLinkError') && (
        <SignInPrompt
          state={state}
          onEmailChange={(email) => dispatch({ type: 'EMAIL_CHANGED', email })}
          onSubmitEmail={() => {
            const { email, url } = state;
            dispatch({ type: 'SUBMIT_EMAIL' });
            void submitMagicLink(email, url);
          }}
          onEditUrl={() => dispatch({ type: 'EDIT_URL' })}
          onResend={() => {
            const { email, url } = state;
            dispatch({ type: 'RESEND_EMAIL' });
            void submitMagicLink(email, url);
          }}
          onRetryEmail={() => dispatch({ type: 'RETRY_EMAIL' })}
        />
      )}
    </main>
  );
}

export default function DiagnosticInputPage() {
  return (
    <Suspense fallback={<main className="mx-auto flex max-w-xl flex-col gap-6 px-6 py-16">Loading…</main>}>
      <DiagnosticInputPageInner />
    </Suspense>
  );
}
