'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { AppNav } from '@/components/AppNav';
import { GlossaryText } from '@/components/GlossaryChip';

interface StrategyBreakdownData {
  platform: 'youtube' | 'tiktok' | 'instagram';
  channel_handle: string;
  post_count: number;
  cadence: { postCount: number; spanDays: number; postsPerWeek: number; mostCommonDayOfWeek: string | null };
  format_mix: {
    averageDurationSeconds: number;
    shortPct: number;
    mediumPct: number;
    longPct: number;
    // Optional: breakdowns saved before this field existed don't carry it.
    postsWithUnknownDuration?: number;
  };
  top_posts: Array<{ captionOrTitle: string; viewCount: number }>;
  headline: string;
  explanation: string;
}

export default function StrategyBreakdownPage() {
  const params = useParams<{ id: string }>();
  const [breakdown, setBreakdown] = useState<StrategyBreakdownData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/strategy/${encodeURIComponent(params.id)}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setError(data.error);
          return;
        }
        setBreakdown(data.breakdown);
      })
      .catch(() => {
        if (!cancelled) setError('Something went wrong loading your breakdown. Please try again.');
      });
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  if (error) {
    return (
      <>
        <AppNav />
        <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
          <p role="alert">{error}</p>
        </main>
      </>
    );
  }

  if (!breakdown) {
    return (
      <>
        <AppNav />
        <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
          <p>Loading your breakdown…</p>
        </main>
      </>
    );
  }

  return (
    <>
      <AppNav />
      <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
        <h1 className="text-2xl font-bold text-gray-900">{breakdown.headline}</h1>
        <p className="text-sm text-gray-500">
          {breakdown.platform} · @{breakdown.channel_handle} · {breakdown.post_count} posts analyzed
        </p>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <div className="rounded-lg border border-gray-200 p-3">
            <p className="text-xs text-gray-500">Posts per week</p>
            <p className="text-lg font-semibold text-gray-900">{breakdown.cadence.postsPerWeek}</p>
          </div>
          <div className="rounded-lg border border-gray-200 p-3">
            <p className="text-xs text-gray-500">Most common day</p>
            <p className="text-lg font-semibold text-gray-900">{breakdown.cadence.mostCommonDayOfWeek ?? '—'}</p>
          </div>
          <div className="rounded-lg border border-gray-200 p-3">
            <p className="text-xs text-gray-500">Short-form (&le;60s)</p>
            <p className="text-lg font-semibold text-gray-900">{breakdown.format_mix.shortPct}%</p>
          </div>
          <div className="rounded-lg border border-gray-200 p-3">
            <p className="text-xs text-gray-500">Medium-form (60-240s)</p>
            <p className="text-lg font-semibold text-gray-900">{breakdown.format_mix.mediumPct}%</p>
          </div>
          <div className="rounded-lg border border-gray-200 p-3">
            <p className="text-xs text-gray-500">Long-form (&gt;240s)</p>
            <p className="text-lg font-semibold text-gray-900">{breakdown.format_mix.longPct}%</p>
          </div>
        </div>

        {/* The length mix can only cover posts that actually have a duration
            (photos and carousels don't), so say so rather than letting the
            percentages read as the whole channel. */}
        {(breakdown.format_mix.postsWithUnknownDuration ?? 0) > 0 && (
          <p className="text-xs text-gray-500">
            Length mix covers the {breakdown.post_count - (breakdown.format_mix.postsWithUnknownDuration ?? 0)} of{' '}
            {breakdown.post_count} posts with a video length — photos and carousels don&apos;t have one.
          </p>
        )}

        <div className="text-base leading-relaxed text-gray-800">
          <GlossaryText text={breakdown.explanation} />
        </div>

        {breakdown.top_posts.length > 0 && (
          <div className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-gray-900">Top posts referenced</h2>
            <ul className="flex flex-col gap-1">
              {breakdown.top_posts.map((post, index) => (
                <li key={index} className="text-sm text-gray-700">
                  {post.captionOrTitle} — {post.viewCount.toLocaleString()} views
                </li>
              ))}
            </ul>
          </div>
        )}
      </main>
    </>
  );
}
