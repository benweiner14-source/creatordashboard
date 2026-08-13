'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

interface RecapCardData {
  month: string;
  totals: { views: number; likes: number; comments: number; postCount: number };
  topPost: { platform: string; captionOrTitle: string; viewCount: number; permalink: string };
  warnings?: string[];
}

const PLATFORM_LABELS: Record<string, string> = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram' };

/**
 * Turns the stored `{platform}_scrape_failed` markers into something a
 * creator can act on — otherwise a partially-scraped card silently
 * under-reports and nobody ever finds out why.
 */
function describeWarnings(warnings: string[] | undefined): string | null {
  const platforms = (warnings ?? [])
    .map((warning) => warning.replace(/_scrape_failed$/, ''))
    .map((platform) => PLATFORM_LABELS[platform] ?? platform)
    .filter(Boolean);
  if (platforms.length === 0) return null;
  const list =
    platforms.length === 1
      ? platforms[0]
      : `${platforms.slice(0, -1).join(', ')} and ${platforms[platforms.length - 1]}`;
  return `Note: ${list} couldn't be reached when this card was generated, so those posts aren't counted here.`;
}

export default function RecapCardPage() {
  const params = useParams<{ id: string }>();
  const [card, setCard] = useState<RecapCardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/recap/${params.id}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setError(data.error);
          return;
        }
        setCard(data.recapCard);
      })
      .catch(() => {
        if (!cancelled) setError('Something went wrong loading this recap card. Please try again.');
      });
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  if (error) {
    return <p role="alert">{error}</p>;
  }

  if (!card) {
    return <p>Loading your recap card…</p>;
  }

  const monthLabel = new Date(card.month).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const warningNote = describeWarnings(card.warnings);

  return (
    <main className="mx-auto flex max-w-md flex-col items-center gap-6 px-6 py-16 text-center">
      <h1 className="text-2xl font-bold text-gray-900">{monthLabel} Recap</h1>
      <img
        src={`/recap/${params.id}/image`}
        alt={`${monthLabel} recap card: ${card.totals.views} total views`}
        className="w-full rounded-lg shadow-lg"
      />
      {warningNote && (
        <p role="status" className="text-sm text-amber-700">
          {warningNote}
        </p>
      )}
      <a
        href={`/recap/${params.id}/image`}
        download
        className="rounded-full bg-indigo-600 px-6 py-3 font-semibold text-white hover:bg-indigo-700"
      >
        Download image
      </a>
      {/* Without this, /recap redirects here for the rest of the month and a
          creator has no way back to add a platform or fix a typo. */}
      <Link href="/recap?edit=1" className="text-sm text-indigo-700 underline">
        Manage platforms
      </Link>
    </main>
  );
}
