'use client';

import { Suspense, useEffect, useReducer, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Spinner } from '@/components/Spinner';
import { SignInPrompt } from '@/components/SignInPrompt';
import {
  recapPageReducer,
  createInitialRecapPageState,
  isHandleEditingState,
  type RecapHandleInputs,
  type RecapConnectionStatus,
} from '@/lib/recap/page-state';
import type { RecapPlatform } from '@/lib/recap/types';

const PLATFORM_LABELS: Record<RecapPlatform, string> = {
  youtube: 'YouTube channel handle',
  tiktok: 'TikTok handle',
  instagram: 'Instagram handle',
};

const OAUTH_PLATFORM_NAMES: Record<'tiktok' | 'instagram', string> = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
};

function isOAuthPlatform(platform: RecapPlatform): platform is 'tiktok' | 'instagram' {
  return platform === 'tiktok' || platform === 'instagram';
}

function RecapPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // /recap?edit=1 is how a creator gets back to the handle form after a card
  // already exists for this month — without it the bootstrap redirect makes
  // /recap a dead end until the month rolls over.
  const editMode = searchParams.get('edit') === '1';
  const [state, dispatch] = useReducer(recapPageReducer, createInitialRecapPageState());
  const stillWorkingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Read once on first render — a full page navigation to the OAuth
  // provider and back is how connected=/oauthError= ever get here.
  const [toast] = useState<{ kind: 'success' | 'error'; message: string } | null>(() => {
    const connected = searchParams.get('connected');
    const oauthError = searchParams.get('oauthError');
    if (connected === 'tiktok' || connected === 'instagram') {
      return { kind: 'success', message: `${OAUTH_PLATFORM_NAMES[connected]} connected!` };
    }
    if (oauthError === 'denied') {
      return { kind: 'error', message: "You didn't grant access — no problem, your existing setup is unaffected." };
    }
    if (oauthError) {
      return { kind: 'error', message: 'Something went wrong connecting that platform. Please try again.' };
    }
    return null;
  });

  useEffect(() => {
    if (!toast) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete('connected');
    params.delete('oauthError');
    const query = params.toString();
    router.replace(query ? `/recap?${query}` : '/recap', { scroll: false });
    // Only ever run once per mount — re-running on every searchParams
    // change would immediately re-trigger from the replaced URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/recap')
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401) {
          dispatch({ type: 'BOOTSTRAP_UNAUTHORIZED' });
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        if (data.error) {
          dispatch({ type: 'BOOTSTRAP_FAILED' });
          return;
        }
        const handles: RecapHandleInputs = {
          youtube: data.handles.youtube ?? '',
          tiktok: data.handles.tiktok ?? '',
          instagram: data.handles.instagram ?? '',
        };
        const connections: RecapConnectionStatus = {
          tiktok: Boolean(data.connections?.tiktok),
          instagram: Boolean(data.connections?.instagram),
        };
        dispatch({ type: 'BOOTSTRAPPED', handles, connections, recapCardId: editMode ? null : data.recapCardId });
      })
      .catch(() => {
        if (!cancelled) dispatch({ type: 'BOOTSTRAP_FAILED' });
      });
    return () => {
      cancelled = true;
    };
  }, [editMode]);

  useEffect(() => {
    if (state.status === 'redirectingToCard') {
      router.push(`/recap/${state.recapCardId}`);
    }
  }, [state, router]);

  useEffect(() => {
    if (state.status !== 'generating') return undefined;
    stillWorkingTimer.current = setTimeout(() => dispatch({ type: 'GENERATE_STILL_WORKING' }), 8000);
    return () => {
      if (stillWorkingTimer.current) clearTimeout(stillWorkingTimer.current);
    };
  }, [state.status]);

  async function saveHandles() {
    if (!isHandleEditingState(state)) return;
    try {
      const res = await fetch('/api/recap/handles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state.handles),
      });
      const data = await res.json();
      if (!res.ok) {
        dispatch({ type: 'HANDLES_SAVE_FAILED', error: data.error ?? 'Something went wrong saving your handles.' });
        return;
      }
      dispatch({ type: 'HANDLES_SAVED' });
    } catch {
      dispatch({
        type: 'HANDLES_SAVE_FAILED',
        error: "We couldn't reach the server. Check your connection and try again.",
      });
    }
  }

  async function disconnect(platform: 'tiktok' | 'instagram') {
    const res = await fetch(`/api/oauth/${platform}/disconnect`, { method: 'POST' }).catch(() => null);
    if (res?.ok) {
      dispatch({ type: 'DISCONNECTED', platform });
    }
  }

  async function generate() {
    dispatch({ type: 'GENERATE' });
    try {
      const res = await fetch('/api/recap', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        dispatch({ type: 'GENERATE_FAILED', error: data.error ?? 'Something went wrong generating your recap card.' });
        return;
      }
      dispatch({ type: 'GENERATE_SUCCESS', recapCardId: data.recapCard.id });
    } catch {
      dispatch({ type: 'GENERATE_FAILED', error: "We couldn't reach the server. Check your connection and try again." });
    }
  }

  async function submitMagicLink(email: string) {
    try {
      const response = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, redirectPath: '/recap' }),
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

  if (state.status === 'loading' || state.status === 'redirectingToCard') {
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
        <h1 className="text-2xl font-bold text-gray-900">Monthly recap card</h1>
        <SignInPrompt
          state={state}
          introCopy="Sign in with a one-time email link to set up your recap card."
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

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-6 py-16">
      <h1 className="text-2xl font-bold text-gray-900">Monthly recap card</h1>
      <p className="text-gray-600">Connect your platforms once, then generate a shareable card of this month&apos;s stats.</p>

      {toast && (
        <p role="alert" className={toast.kind === 'success' ? 'text-sm text-green-700' : 'text-sm text-red-600'}>
          {toast.message}
        </p>
      )}

      <div className="flex flex-col gap-3">
        {(['youtube', 'tiktok', 'instagram'] as const).map((platform) => {
          const connected = isOAuthPlatform(platform) && state.connections[platform];

          if (connected && isOAuthPlatform(platform)) {
            return (
              <div key={platform} className="flex flex-col gap-1 text-sm font-medium text-gray-700">
                {PLATFORM_LABELS[platform]}
                <div className="flex items-center justify-between gap-2 rounded-lg border border-gray-300 px-4 py-2 font-normal">
                  <span>Connected via {OAUTH_PLATFORM_NAMES[platform]} ✓</span>
                  <button type="button" onClick={() => disconnect(platform)} className="text-indigo-700 underline">
                    Disconnect
                  </button>
                </div>
              </div>
            );
          }

          return (
            <label key={platform} className="flex flex-col gap-1 text-sm font-medium text-gray-700">
              {PLATFORM_LABELS[platform]}
              <input
                type="text"
                value={state.handles[platform]}
                onChange={(e) => dispatch({ type: 'HANDLE_CHANGED', platform, value: e.target.value })}
                placeholder="@handle or profile URL"
                // Generation is the one state where the form legitimately can't
                // accept edits — say so rather than silently swallowing them.
                disabled={state.status === 'generating'}
                className="rounded-lg border border-gray-300 px-4 py-2 font-normal disabled:bg-gray-50"
              />
              {isOAuthPlatform(platform) && (
                <a href={`/api/oauth/${platform}/authorize`} className="self-start text-xs text-indigo-700 underline">
                  Or connect via {OAUTH_PLATFORM_NAMES[platform]}
                </a>
              )}
            </label>
          );
        })}
        <button
          type="button"
          onClick={saveHandles}
          disabled={state.status === 'generating'}
          className="self-start rounded-full border border-indigo-600 px-4 py-2 text-sm font-semibold text-indigo-700 disabled:opacity-50"
        >
          Save platforms
        </button>
      </div>

      {state.status === 'noHandlesConnected' && state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}

      {state.status === 'readyToGenerate' && (
        <button
          type="button"
          onClick={generate}
          className="rounded-full bg-indigo-600 px-6 py-3 font-semibold text-white hover:bg-indigo-700"
        >
          Generate this month&apos;s recap
        </button>
      )}

      {state.status === 'generating' && (
        <Spinner label={state.stillWorking ? 'Still working — pulling your posts from each platform…' : 'Generating…'} />
      )}

      {state.status === 'generationFailed' && (
        <div className="flex flex-col gap-2">
          <p role="alert" className="text-sm text-red-600">
            {state.error}
          </p>
          <button
            type="button"
            onClick={generate}
            className="self-start rounded-full bg-indigo-600 px-6 py-3 font-semibold text-white hover:bg-indigo-700"
          >
            Try again
          </button>
        </div>
      )}
    </main>
  );
}

export default function RecapPage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <RecapPageInner />
    </Suspense>
  );
}
