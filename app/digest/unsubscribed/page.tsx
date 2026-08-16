'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

function UnsubscribedPageInner() {
  const searchParams = useSearchParams();
  const status = searchParams.get('status');

  if (status === 'invalid') {
    return (
      <main className="mx-auto flex max-w-md flex-col gap-4 px-6 py-16 text-center">
        <h1 className="text-2xl font-bold text-gray-900">That link didn&apos;t work</h1>
        <p className="text-gray-600">
          This unsubscribe link is invalid or has expired. If you&apos;re still getting emails you don&apos;t want, sign in and turn
          off the toggle on the Weekly Content Ideas page.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 px-6 py-16 text-center">
      <h1 className="text-2xl font-bold text-gray-900">You&apos;re unsubscribed</h1>
      <p className="text-gray-600">
        You won&apos;t get any more weekly content idea emails. You can turn them back on anytime from the Weekly Content Ideas
        page.
      </p>
    </main>
  );
}

export default function UnsubscribedPage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <UnsubscribedPageInner />
    </Suspense>
  );
}
