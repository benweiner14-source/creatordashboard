'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

interface RecapCardData {
  month: string;
  totals: { views: number; likes: number; comments: number; postCount: number };
  topPost: { platform: string; captionOrTitle: string; viewCount: number; permalink: string };
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

  return (
    <main className="mx-auto flex max-w-md flex-col items-center gap-6 px-6 py-16 text-center">
      <h1 className="text-2xl font-bold text-gray-900">{monthLabel} Recap</h1>
      <img
        src={`/recap/${params.id}/image`}
        alt={`${monthLabel} recap card: ${card.totals.views} total views`}
        className="w-full rounded-lg shadow-lg"
      />
      <a
        href={`/recap/${params.id}/image`}
        download
        className="rounded-full bg-indigo-600 px-6 py-3 font-semibold text-white hover:bg-indigo-700"
      >
        Download image
      </a>
    </main>
  );
}
