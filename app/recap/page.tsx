'use client';

import { useEffect, useReducer, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Spinner } from '@/components/Spinner';
import { recapPageReducer, createInitialRecapPageState, type RecapHandleInputs } from '@/lib/recap/page-state';
import type { RecapPlatform } from '@/lib/recap/types';

const PLATFORM_LABELS: Record<RecapPlatform, string> = {
  youtube: 'YouTube channel handle',
  tiktok: 'TikTok handle',
  instagram: 'Instagram handle',
};

export default function RecapPage() {
  const router = useRouter();
  const [state, dispatch] = useReducer(recapPageReducer, createInitialRecapPageState());
  const stillWorkingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/recap')
      .then((res) => res.json())
      .then((data) => {
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
        dispatch({ type: 'BOOTSTRAPPED', handles, recapCardId: data.recapCardId });
      })
      .catch(() => {
        if (!cancelled) dispatch({ type: 'BOOTSTRAP_FAILED' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
    if (state.status !== 'noHandlesConnected' && state.status !== 'readyToGenerate') return;
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

  if (state.status === 'loading' || state.status === 'redirectingToCard') {
    return <p>Loading…</p>;
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-6 py-16">
      <h1 className="text-2xl font-bold text-gray-900">Monthly recap card</h1>
      <p className="text-gray-600">Connect your platforms once, then generate a shareable card of this month&apos;s stats.</p>

      <div className="flex flex-col gap-3">
        {(['youtube', 'tiktok', 'instagram'] as const).map((platform) => (
          <label key={platform} className="flex flex-col gap-1 text-sm font-medium text-gray-700">
            {PLATFORM_LABELS[platform]}
            <input
              type="text"
              value={state.handles[platform]}
              onChange={(e) => dispatch({ type: 'HANDLE_CHANGED', platform, value: e.target.value })}
              placeholder="@handle or profile URL"
              className="rounded-lg border border-gray-300 px-4 py-2 font-normal"
            />
          </label>
        ))}
        <button
          type="button"
          onClick={saveHandles}
          className="self-start rounded-full border border-indigo-600 px-4 py-2 text-sm font-semibold text-indigo-700"
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
