'use client';

import { Suspense, useEffect, useReducer, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppNav } from '@/components/AppNav';
import { Spinner } from '@/components/Spinner';
import { SignInPrompt } from '@/components/SignInPrompt';
import { UpgradePrompt } from '@/components/UpgradePrompt';
import { ideasPageReducer, createInitialIdeasPageState, isNicheEditingState } from '@/lib/ideas/page-state';
import type { ContentIdea } from '@/lib/integrations/claude-ideas';

const MEDIUM_LABELS: Record<ContentIdea['medium'], string> = {
  reel: 'Reel',
  carousel: 'Carousel',
  both: 'Reel + Carousel',
};

function IdeasPageInner() {
  const [state, dispatch] = useReducer(ideasPageReducer, createInitialIdeasPageState());
  const searchParams = useSearchParams();
  const warroomContext = searchParams.get('context');
  const stillWorkingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [contextConsumed, setContextConsumed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/ideas')
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
        if (cancelled) return;
        if (data.error) {
          dispatch({ type: 'BOOTSTRAP_FAILED' });
          return;
        }
        dispatch({
          type: 'BOOTSTRAPPED',
          niche: data.niche ?? '',
          ideas: data.digest?.contentIdeas ?? null,
        });
      })
      .catch(() => {
        if (!cancelled) dispatch({ type: 'BOOTSTRAP_FAILED' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (state.status !== 'generating') return undefined;
    stillWorkingTimer.current = setTimeout(() => dispatch({ type: 'GENERATE_STILL_WORKING' }), 8000);
    return () => {
      if (stillWorkingTimer.current) clearTimeout(stillWorkingTimer.current);
    };
  }, [state.status]);

  async function saveNiche() {
    if (!isNicheEditingState(state)) return;
    try {
      const res = await fetch('/api/ideas/niche', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ niche: state.niche }),
      });
      const data = await res.json();
      if (!res.ok) {
        dispatch({ type: 'NICHE_SAVE_FAILED', error: data.error ?? 'Something went wrong saving your niche.' });
        return;
      }
      dispatch({ type: 'NICHE_SAVED' });
    } catch {
      dispatch({ type: 'NICHE_SAVE_FAILED', error: "We couldn't reach the server. Check your connection and try again." });
    }
  }

  async function generate() {
    dispatch({ type: 'GENERATE' });
    try {
      const res = warroomContext
        ? await fetch('/api/ideas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ context: warroomContext }),
          })
        : await fetch('/api/ideas', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        dispatch({ type: 'GENERATE_FAILED', error: data.error ?? 'Something went wrong generating your content ideas.' });
        return;
      }
      if (warroomContext) {
        setContextConsumed(!data.cached);
      }
      dispatch({ type: 'GENERATE_SUCCESS', ideas: data.digest.contentIdeas, cached: data.cached ?? false });
    } catch {
      dispatch({ type: 'GENERATE_FAILED', error: "We couldn't reach the server. Check your connection and try again." });
    }
  }

  async function submitMagicLink(email: string) {
    try {
      const response = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, redirectPath: '/ideas' }),
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
        <h1 className="text-2xl font-bold text-gray-900">Weekly content ideas</h1>
        <SignInPrompt
          state={state}
          introCopy="Sign in with a one-time email link to get your weekly content ideas."
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
          <h1 className="text-2xl font-bold text-gray-900">Weekly content ideas</h1>
          <UpgradePrompt
            title="Weekly Content Ideas is part of Creator Dashboard's paid plan"
            body="Get a ranked shortlist of GTA 6 content concepts every week for $10/mo."
          />
        </main>
      </>
    );
  }

  return (
    <>
      <AppNav />
      <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
        <h1 className="text-2xl font-bold text-gray-900">Weekly content ideas</h1>
        <p className="text-gray-600">Set your GTA 6 focus once, then get a ranked shortlist of Reel and carousel concepts for the week.</p>

        <div className="flex flex-col gap-3">
          <label htmlFor="ideas-niche" className="flex flex-col gap-1 text-sm font-medium text-gray-700">
            Your GTA 6 focus
            <input
              id="ideas-niche"
              type="text"
              value={state.niche}
              onChange={(e) => dispatch({ type: 'NICHE_CHANGED', value: e.target.value })}
              placeholder="e.g. GTA RP, speedrunning, comedy skits, mod showcases, lore theories"
              disabled={state.status === 'generating' || state.status === 'ideasReady'}
              className="rounded-lg border border-gray-300 px-4 py-2 font-normal disabled:bg-gray-50"
            />
          </label>
          {isNicheEditingState(state) && (
            <button
              type="button"
              onClick={saveNiche}
              className="self-start rounded-full border border-indigo-600 px-4 py-2 text-sm font-semibold text-indigo-700 disabled:opacity-50"
            >
              Save niche
            </button>
          )}
          {state.status === 'ideasReady' && (
            <button
              type="button"
              onClick={() => dispatch({ type: 'EDIT_NICHE' })}
              className="self-start text-sm text-indigo-700 underline"
            >
              Edit niche
            </button>
          )}
        </div>

        {state.status === 'needsNiche' && state.error && (
          <p role="alert" className="text-sm text-red-600">
            {state.error}
          </p>
        )}

        {state.status === 'readyToGenerate' && (
          <button
            type="button"
            onClick={generate}
            className="self-start rounded-full bg-indigo-600 px-6 py-3 font-semibold text-white hover:bg-indigo-700"
          >
            Get this week&apos;s ideas
          </button>
        )}

        {state.status === 'generating' && (
          <Spinner label={state.stillWorking ? 'Still working — researching your niche…' : 'Generating…'} />
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

        {state.status === 'ideasReady' && (
          <div className="flex flex-col gap-4">
            {warroomContext && !contextConsumed ? (
              <p className="rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-800">
                You started from a War Room alert, but this week&apos;s ideas were already generated — new ideas are
                ready again next Monday.
              </p>
            ) : (
              state.cached && (
                <p className="rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-800">
                  These are this week&apos;s saved ideas — your niche update will apply starting next week.
                </p>
              )
            )}
            {state.ideas.map((idea, index) => {
              const safeSourceUrl = idea.sourceUrl && /^https?:\/\//i.test(idea.sourceUrl) ? idea.sourceUrl : null;
              return (
                <article key={index} className="flex flex-col gap-2 rounded-lg border border-gray-200 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-lg font-semibold text-gray-900">{idea.workingTitle}</h2>
                    <span className="whitespace-nowrap rounded-full bg-indigo-100 px-3 py-1 text-xs font-medium text-indigo-700">
                      {MEDIUM_LABELS[idea.medium]} · {idea.format}
                    </span>
                  </div>
                  <p className="text-gray-700">{idea.pitch}</p>
                  <p className="text-sm text-gray-600">
                    <strong>Why it&apos;s hot now:</strong> {idea.whyItsHotNow}
                    {safeSourceUrl && (
                      <>
                        {' — '}
                        <a href={safeSourceUrl} target="_blank" rel="noreferrer" className="text-indigo-700 underline">
                          source
                        </a>
                      </>
                    )}
                  </p>
                  <p className="text-sm text-gray-600">
                    <strong>Why it ranks here:</strong> {idea.whyItRanksHere} ({idea.kpiSignals.join(', ')})
                  </p>
                  {idea.reelDetails && (
                    <p className="text-sm text-gray-500">
                      Reel: ~{idea.reelDetails.suggestedLengthSeconds}s,{' '}
                      {idea.reelDetails.style === 'talking-head' ? 'talking-head' : 'VO over capture'}
                    </p>
                  )}
                  {idea.carouselDetails && (
                    <p className="text-sm text-gray-500">
                      Carousel: {idea.carouselDetails.hookFormula} — &ldquo;{idea.carouselDetails.coverLine}&rdquo; (
                      {idea.carouselDetails.slideCount} slides)
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </main>
    </>
  );
}

export default function IdeasPage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <IdeasPageInner />
    </Suspense>
  );
}
