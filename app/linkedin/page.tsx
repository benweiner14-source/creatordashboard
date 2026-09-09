'use client';

import { useEffect, useReducer, useRef, useState } from 'react';
import { AppNav } from '@/components/AppNav';
import { Spinner } from '@/components/Spinner';
import { SignInPrompt } from '@/components/SignInPrompt';
import { UpgradePrompt } from '@/components/UpgradePrompt';
import { GlossaryText } from '@/components/GlossaryChip';
import { LinkedInIdeasSection } from '@/components/LinkedInIdeasSection';
import { LinkedInAuditSection } from '@/components/LinkedInAuditSection';
import { linkedInPageReducer, createInitialLinkedInPageState } from '@/lib/linkedin/page-state';

const NICHE_OPTIONS = [
  'Gaming & esports',
  'Fitness & wellness',
  'Fashion & beauty',
  'Food & cooking',
  'Music & entertainment',
  'Tech & business',
  'Comedy & lifestyle',
];

const GOAL_OPTIONS = [
  'Land brand or product partnerships',
  'Get noticed for jobs or internships',
  'Build long-term credibility in my field',
  'Not sure yet — just want to look professional',
];

export default function LinkedInPage() {
  const [state, dispatch] = useReducer(linkedInPageReducer, createInitialLinkedInPageState());
  const stillWorkingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/linkedin/strategy')
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
        dispatch({ type: 'BOOTSTRAPPED', strategy: data.latest ?? null, history: data.history ?? [] });
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

  async function submitStrategy(niche: string, targetGoal: string) {
    try {
      const response = await fetch('/api/linkedin/strategy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ niche, targetGoal }),
      });
      const data = await response.json();
      if (!response.ok) {
        dispatch({ type: 'GENERATE_FAILED', error: data.error ?? 'Something went wrong. Please try again.' });
        return;
      }
      dispatch({ type: 'GENERATE_SUCCESS', strategy: data.strategy });
    } catch {
      dispatch({
        type: 'GENERATE_FAILED',
        error: "Something went wrong on our end. Try again in a moment — your attempt hasn't been used up.",
      });
    }
  }

  async function submitMagicLink(email: string) {
    try {
      const response = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, redirectPath: '/linkedin' }),
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
        <h1 className="text-2xl font-bold text-gray-900">LinkedIn content strategy</h1>
        <SignInPrompt
          state={state}
          introCopy="Sign in with a one-time email link to build your LinkedIn strategy."
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
          <h1 className="text-2xl font-bold text-gray-900">LinkedIn content strategy</h1>
          <UpgradePrompt
            title="LinkedIn Content Strategy is part of Creator Dashboard's paid plan"
            body="Get a LinkedIn content strategy, fresh post ideas every week, and a profile audit, all for $10/mo."
          />
        </main>
      </>
    );
  }

  if (state.status === 'onboarding' || state.status === 'generating' || state.status === 'generationFailed') {
    const prefillNiche = state.status === 'onboarding' ? state.prefillNiche : state.niche;
    const prefillTargetGoal = state.status === 'onboarding' ? state.prefillTargetGoal : state.targetGoal;
    return (
      <>
        <AppNav />
        <main className="mx-auto flex max-w-xl flex-col gap-6 px-6 py-16">
          <h1 className="text-2xl font-bold text-gray-900">LinkedIn content strategy</h1>
          <p className="text-gray-600">
            Brands and companies often check LinkedIn before deciding who to work with or hire — it&apos;s less about
            going viral and more about looking credible to the right person.
          </p>
          <OnboardingForm
            prefillNiche={prefillNiche}
            prefillTargetGoal={prefillTargetGoal}
            submitting={state.status === 'generating'}
            stillWorking={state.status === 'generating' && state.stillWorking}
            onSubmit={(niche, targetGoal) => {
              dispatch({ type: 'GENERATE', niche, targetGoal });
              void submitStrategy(niche, targetGoal);
            }}
          />
          {state.status === 'generationFailed' && (
            <p role="alert" className="text-sm text-red-600">
              {state.error}
            </p>
          )}
        </main>
      </>
    );
  }

  const { strategy, history } = state;
  return (
    <>
      <AppNav />
      <main className="mx-auto flex max-w-2xl flex-col gap-10 px-6 py-16">
        <section className="flex flex-col gap-4">
          <h1 className="text-2xl font-bold text-gray-900">
            <GlossaryText text={strategy.headline} />
          </h1>
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Content pillars</h2>
            <ul className="mt-2 flex flex-col gap-1">
              {strategy.contentPillars.map((pillar, index) => (
                <li key={index} className="text-gray-800">
                  <GlossaryText text={pillar} />
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Posting cadence</h2>
            <p className="mt-2 text-gray-800">
              <GlossaryText text={strategy.postingCadenceRecommendation} />
            </p>
          </div>
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Positioning</h2>
            <p className="mt-2 text-gray-800">
              <GlossaryText text={strategy.positioningNotes} />
            </p>
          </div>
          <button
            type="button"
            onClick={() => dispatch({ type: 'EDIT_STRATEGY_INPUTS' })}
            className="self-start text-sm font-medium text-indigo-700 underline hover:text-indigo-900"
          >
            Change niche or goal
          </button>
          {history.length > 1 && (
            <div className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Past strategies</h2>
              <ul className="flex flex-col gap-1 text-sm text-gray-600">
                {history.slice(1).map((item) => (
                  <li key={item.id}>
                    {item.headline} — {item.niche} / {item.targetGoal}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <LinkedInIdeasSection />
        <LinkedInAuditSection />
      </main>
    </>
  );
}

interface OnboardingFormProps {
  prefillNiche: string;
  prefillTargetGoal: string;
  submitting: boolean;
  stillWorking: boolean;
  onSubmit: (niche: string, targetGoal: string) => void;
}

function OnboardingForm({ prefillNiche, prefillTargetGoal, submitting, stillWorking, onSubmit }: OnboardingFormProps) {
  const [niche, setNiche] = useState(prefillNiche);
  const [targetGoal, setTargetGoal] = useState(prefillTargetGoal);
  const [customNiche, setCustomNiche] = useState(prefillNiche !== '' && !NICHE_OPTIONS.includes(prefillNiche));
  const [customGoal, setCustomGoal] = useState(prefillTargetGoal !== '' && !GOAL_OPTIONS.includes(prefillTargetGoal));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(niche, targetGoal);
      }}
      className="flex flex-col gap-6"
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-gray-700">What&apos;s your content about?</legend>
        <div className="flex flex-wrap gap-2">
          {NICHE_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                setCustomNiche(false);
                setNiche(option);
              }}
              aria-pressed={!customNiche && niche === option}
              className={`rounded-full border px-4 py-2 text-sm ${
                !customNiche && niche === option ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-gray-300 text-gray-700'
              }`}
            >
              {option}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setCustomNiche(true);
              setNiche('');
            }}
            aria-pressed={customNiche}
            className={`rounded-full border px-4 py-2 text-sm ${
              customNiche ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-gray-300 text-gray-700'
            }`}
          >
            Something else
          </button>
        </div>
        {customNiche && (
          <input
            aria-label="Your content niche"
            type="text"
            value={niche}
            onChange={(e) => setNiche(e.target.value)}
            placeholder="e.g. sustainable fashion, or K-pop fan content"
            className="rounded-lg border border-gray-300 px-4 py-2"
          />
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-gray-700">What are you hoping to get out of LinkedIn?</legend>
        <div className="flex flex-wrap gap-2">
          {GOAL_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                setCustomGoal(false);
                setTargetGoal(option);
              }}
              aria-pressed={!customGoal && targetGoal === option}
              className={`rounded-full border px-4 py-2 text-sm ${
                !customGoal && targetGoal === option ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-gray-300 text-gray-700'
              }`}
            >
              {option}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setCustomGoal(true);
              setTargetGoal('');
            }}
            aria-pressed={customGoal}
            className={`rounded-full border px-4 py-2 text-sm ${
              customGoal ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-gray-300 text-gray-700'
            }`}
          >
            Something else
          </button>
        </div>
        {customGoal && (
          <input
            aria-label="Your LinkedIn goal"
            type="text"
            value={targetGoal}
            onChange={(e) => setTargetGoal(e.target.value)}
            placeholder="e.g. get noticed by esports team managers"
            className="rounded-lg border border-gray-300 px-4 py-2"
          />
        )}
      </fieldset>

      <button
        type="submit"
        disabled={submitting || !niche.trim() || !targetGoal.trim()}
        className="self-start rounded-full bg-indigo-600 px-6 py-3 font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {submitting ? (
          <Spinner label={stillWorking ? 'Still working — thinking through your strategy…' : 'Building…'} />
        ) : (
          'Build my strategy'
        )}
      </button>
    </form>
  );
}
