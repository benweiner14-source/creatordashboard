'use client';

import { useEffect, useState } from 'react';
import { GlossaryText } from '@/components/GlossaryChip';

interface LinkedInPostIdea {
  workingTitle: string;
  angle: string;
  whyItFitsYourGoal: string;
}

type IdeasSectionState =
  | { status: 'loading' }
  // Nothing generated for this week yet. Generating costs a paid Claude call
  // and one of the creator's daily attempts, so it waits for a deliberate
  // click rather than firing on mount.
  | { status: 'idle' }
  | { status: 'generating' }
  | { status: 'ready'; ideas: LinkedInPostIdea[] }
  | { status: 'empty' }
  | { status: 'error'; error: string };

export function LinkedInIdeasSection() {
  const [state, setState] = useState<IdeasSectionState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetch('/api/linkedin/ideas')
      .then(async (res) => {
        if (cancelled) return;
        const data = await res.json();
        if (!res.ok) {
          setState({ status: 'error', error: data.error ?? 'Something went wrong loading your post ideas.' });
          return;
        }
        if (!data.ideas) {
          setState({ status: 'idle' });
          return;
        }
        const ideas: LinkedInPostIdea[] = data.ideas.postIdeas ?? [];
        setState(ideas.length > 0 ? { status: 'ready', ideas } : { status: 'empty' });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error', error: "We couldn't reach the server. Check your connection and try again." });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function generateIdeas() {
    setState({ status: 'generating' });
    try {
      const response = await fetch('/api/linkedin/ideas', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) {
        setState({ status: 'error', error: data.error ?? 'Something went wrong generating your post ideas.' });
        return;
      }
      const ideas: LinkedInPostIdea[] = data.ideas?.postIdeas ?? [];
      setState(ideas.length > 0 ? { status: 'ready', ideas } : { status: 'empty' });
    } catch {
      setState({ status: 'error', error: "We couldn't reach the server. Check your connection and try again." });
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-bold text-gray-900">This week&apos;s post ideas</h2>
      {state.status === 'loading' && <p className="text-gray-600">Loading…</p>}
      {state.status === 'idle' && (
        <button
          type="button"
          onClick={() => void generateIdeas()}
          className="self-start rounded-full bg-indigo-600 px-6 py-3 font-semibold text-white hover:bg-indigo-700"
        >
          Get this week&apos;s post ideas
        </button>
      )}
      {state.status === 'generating' && <p className="text-gray-600">Coming up with this week&apos;s ideas…</p>}
      {state.status === 'empty' && <p className="text-gray-600">No post ideas yet for this week — check back soon.</p>}
      {state.status === 'error' && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
      {state.status === 'ready' && (
        <ul className="flex flex-col gap-3">
          {state.ideas.map((idea, index) => (
            <li key={index} className="rounded-lg border border-gray-200 p-4">
              <p className="font-semibold text-gray-900">{idea.workingTitle}</p>
              <p className="mt-1 text-gray-700">
                <GlossaryText text={idea.angle} />
              </p>
              <p className="mt-1 text-sm text-gray-500">
                <GlossaryText text={idea.whyItFitsYourGoal} />
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
