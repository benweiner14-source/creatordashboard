'use client';

import { Suspense, useEffect, useReducer, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppNav } from '@/components/AppNav';
import { Banner } from '@/components/Banner';
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

const NICHE_PRESETS = [
  'Roleplay',
  'Heists & Comedy Montages',
  'Speedrunning',
  'Mod Showcases',
  'Guides & Tips',
  'Lore & Leak Theories',
  'Trailer Breakdowns & Reactions',
  'Release-Date Speculation',
] as const;

// These don't need actual GTA6 gameplay to exist, so they still have a real,
// current angle before the game ships — unlike e.g. "Guides & Tips", which
// genuinely has nothing honest to say about a game that isn't out yet.
const PRE_LAUNCH_FRIENDLY_NICHES = new Set<string>([
  'Lore & Leak Theories',
  'Trailer Breakdowns & Reactions',
  'Release-Date Speculation',
]);

const MAX_NICHE_SELECTIONS = 3;

/** Inverse of composeNiche: splits a saved niche string back into known preset chips plus leftover "Other" text. */
function parseNicheIntoChips(niche: string): { selectedChips: string[]; otherText: string } {
  const parts = niche
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const selectedChips: string[] = [];
  const leftovers: string[] = [];
  for (const part of parts) {
    const match = NICHE_PRESETS.find((preset) => preset.toLowerCase() === part.toLowerCase());
    if (match && !selectedChips.includes(match)) {
      selectedChips.push(match);
    } else {
      leftovers.push(part);
    }
  }
  return { selectedChips, otherText: leftovers.join(', ') };
}

function composeNiche(selectedChips: string[], otherText: string): string {
  const trimmedOther = otherText.trim();
  return [...selectedChips, ...(trimmedOther ? [trimmedOther] : [])].join(', ');
}

function IdeasPageInner() {
  const [state, dispatch] = useReducer(ideasPageReducer, createInitialIdeasPageState());
  const searchParams = useSearchParams();
  const warroomContext = searchParams.get('context');
  const stillWorkingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [contextConsumed, setContextConsumed] = useState(false);
  const [selectedChips, setSelectedChips] = useState<string[]>([]);
  const [otherSelected, setOtherSelected] = useState(false);
  const [otherText, setOtherText] = useState('');

  function initializeChipsFromNiche(niche: string) {
    const parsed = parseNicheIntoChips(niche);
    setSelectedChips(parsed.selectedChips);
    setOtherText(parsed.otherText);
    setOtherSelected(parsed.otherText.length > 0);
  }

  const selectionCount = selectedChips.length + (otherSelected ? 1 : 0);

  function toggleChip(chip: string) {
    const isSelected = selectedChips.includes(chip);
    if (!isSelected && selectionCount >= MAX_NICHE_SELECTIONS) return;
    const nextChips = isSelected ? selectedChips.filter((c) => c !== chip) : [...selectedChips, chip];
    setSelectedChips(nextChips);
    dispatch({ type: 'NICHE_CHANGED', value: composeNiche(nextChips, otherSelected ? otherText : '') });
  }

  function toggleOther() {
    if (!otherSelected && selectionCount >= MAX_NICHE_SELECTIONS) return;
    const next = !otherSelected;
    setOtherSelected(next);
    dispatch({ type: 'NICHE_CHANGED', value: composeNiche(selectedChips, next ? otherText : '') });
  }

  function handleOtherTextChange(value: string) {
    setOtherText(value);
    dispatch({ type: 'NICHE_CHANGED', value: composeNiche(selectedChips, value) });
  }

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
        initializeChipsFromNiche(data.niche ?? '');
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
      <main className="mx-auto flex max-w-2xl flex-col gap-[22px] px-6 py-11">
        <div>
          <div className="mb-2 font-mono text-[11px] uppercase tracking-[.2em] text-gray-500">This week</div>
          <h1 className="font-heading text-[34px] font-bold leading-[1.05] text-gray-900">Weekly content ideas</h1>
          <p className="mt-2.5 text-[15px] leading-[1.55] text-gray-600">
            Set your GTA 6 focus once, then get a ranked shortlist of Reel and carousel concepts for the week.
          </p>
        </div>

        <div className="flex flex-col gap-3 rounded-2xl border border-[#e8e8ee] bg-white p-[22px]">
          <p className="text-sm font-semibold text-gray-700">Your GTA 6 focus (pick up to {MAX_NICHE_SELECTIONS})</p>
          <div className="flex flex-wrap gap-[9px]">
            {NICHE_PRESETS.map((preset) => {
              const isSelected = selectedChips.includes(preset);
              const disabled =
                state.status === 'generating' ||
                state.status === 'ideasReady' ||
                (!isSelected && selectionCount >= MAX_NICHE_SELECTIONS);
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => toggleChip(preset)}
                  disabled={disabled}
                  aria-pressed={isSelected}
                  className={`whitespace-nowrap rounded-full px-[15px] py-[9px] text-sm font-medium ${
                    isSelected
                      ? 'bg-brand text-white'
                      : disabled
                        ? 'cursor-not-allowed border border-[#d8d8e0] text-[#c4c4cf]'
                        : 'border border-[#d8d8e0] text-gray-700'
                  }`}
                >
                  {preset}
                  {PRE_LAUNCH_FRIENDLY_NICHES.has(preset) ? ' 🔥' : ''}
                </button>
              );
            })}
            <button
              type="button"
              onClick={toggleOther}
              disabled={
                state.status === 'generating' ||
                state.status === 'ideasReady' ||
                (!otherSelected && selectionCount >= MAX_NICHE_SELECTIONS)
              }
              aria-pressed={otherSelected}
              className={`whitespace-nowrap rounded-full px-[15px] py-[9px] text-sm font-medium ${
                otherSelected ? 'bg-brand text-white' : 'border border-[#d8d8e0] text-gray-700'
              }`}
            >
              Other
            </button>
          </div>
          <p className="mt-0.5 text-xs text-gray-500">🔥 = works great before GTA 6 launches</p>

          {otherSelected && (
            <label htmlFor="ideas-niche-other" className="flex flex-col gap-1 text-sm font-medium text-gray-700">
              Describe your own focus
              <input
                id="ideas-niche-other"
                type="text"
                value={otherText}
                onChange={(e) => handleOtherTextChange(e.target.value)}
                placeholder="e.g. car meet builds, cosplay, fan-made trailers"
                disabled={state.status === 'generating' || state.status === 'ideasReady'}
                className="rounded-[10px] border border-[#d8d8e0] px-[14px] py-[10px] font-normal disabled:bg-gray-50"
              />
            </label>
          )}

          {isNicheEditingState(state) && (
            <button
              type="button"
              onClick={saveNiche}
              className="mt-1 self-start whitespace-nowrap rounded-full border border-[#7c3aed] px-[18px] py-2 text-[13px] font-semibold text-[#6d28d9] disabled:opacity-50"
            >
              Save niche
            </button>
          )}
          {state.status === 'ideasReady' && (
            <button
              type="button"
              onClick={() => {
                initializeChipsFromNiche(state.niche);
                dispatch({ type: 'EDIT_NICHE' });
              }}
              className="mt-1 self-start text-sm text-[#6d28d9] underline"
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
            className="self-start rounded-full bg-brand px-6 py-[13px] font-semibold text-white hover:brightness-105"
          >
            Get this week&apos;s ideas
          </button>
        )}

        {state.status === 'generating' && (
          <Spinner
            variant="onLight"
            label={state.stillWorking ? 'Still working — researching your niche…' : 'Generating…'}
          />
        )}

        {state.status === 'generationFailed' && (
          <div className="flex flex-col gap-2">
            <Banner variant="critical" label="Generation failed" role="alert">
              {state.error}
            </Banner>
            <button
              type="button"
              onClick={generate}
              className="self-start rounded-full bg-brand px-6 py-[13px] font-semibold text-white hover:brightness-105"
            >
              Try again
            </button>
          </div>
        )}

        {state.status === 'ideasReady' && (
          <div className="flex flex-col gap-4">
            <Banner variant="info" label="Platform tip">
              Tip: publishing a Reel directly through Meta&apos;s Edits app currently gets a temporary reach boost,
              per Instagram&apos;s Adam Mosseri (Aug 2025) — not guaranteed to last.
            </Banner>
            {warroomContext && !contextConsumed ? (
              <Banner variant="caution" label="Heads up">
                You started from a War Room alert, but this week&apos;s ideas were already generated — new ideas are
                ready again next Monday.
              </Banner>
            ) : (
              state.cached && (
                <Banner variant="cached" label="Cached">
                  These are this week&apos;s saved ideas — your niche update will apply starting next week.
                </Banner>
              )
            )}
            {state.ideas.map((idea, index) => {
              const safeSourceUrl = idea.sourceUrl && /^https?:\/\//i.test(idea.sourceUrl) ? idea.sourceUrl : null;
              return (
                <article key={index} className="flex flex-col gap-[10px] rounded-2xl border border-[#e8e8ee] bg-white p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="flex-none font-heading text-xl font-bold leading-none text-[#7c3aed]">
                        #{index + 1}
                      </span>
                      <h2 className="font-heading text-xl font-bold leading-[1.15] text-gray-900">{idea.workingTitle}</h2>
                    </div>
                    <span className="flex-none whitespace-nowrap rounded-full bg-[#ede9fe] px-[11px] py-[5px] font-mono text-[10px] uppercase tracking-[.1em] text-[#5b21b6]">
                      {MEDIUM_LABELS[idea.medium]} · {idea.format}
                    </span>
                  </div>
                  <p className="text-sm leading-[1.55] text-gray-700">{idea.pitch}</p>
                  <p className="text-[13px] leading-[1.5] text-gray-500">
                    <strong className="text-gray-600">Why it&apos;s hot now:</strong> {idea.whyItsHotNow}
                    {safeSourceUrl && (
                      <>
                        {' — '}
                        <a href={safeSourceUrl} target="_blank" rel="noreferrer" className="text-[#6d28d9] underline">
                          source
                        </a>
                      </>
                    )}
                  </p>
                  <p className="text-[13px] leading-[1.5] text-gray-500">
                    <strong className="text-gray-600">Why it ranks here:</strong> {idea.whyItRanksHere} (
                    {idea.kpiSignals.join(', ')})
                  </p>
                  {idea.reelDetails && (
                    <span className="w-full mt-0.5 rounded-lg border border-[#e8e8ee] bg-[#f4f4f6] px-[10px] py-[6px] font-mono text-[11px] leading-[1.45] text-gray-500">
                      Reel: ~{idea.reelDetails.suggestedLengthSeconds}s,{' '}
                      {idea.reelDetails.style === 'talking-head' ? 'talking-head' : 'VO over capture'}
                    </span>
                  )}
                  {idea.carouselDetails && (
                    <span className="w-full mt-0.5 rounded-lg border border-[#e8e8ee] bg-[#f4f4f6] px-[10px] py-[6px] font-mono text-[11px] leading-[1.45] text-gray-500">
                      Carousel: {idea.carouselDetails.hookFormula} — &ldquo;{idea.carouselDetails.coverLine}&rdquo; (
                      {idea.carouselDetails.slideCount} slides)
                    </span>
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
