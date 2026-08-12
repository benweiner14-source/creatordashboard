// app/diagnostic/page.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function DiagnosticInputPage() {
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch('/api/diagnostic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? 'Something went wrong. Please try again.');
        return;
      }
      router.push(`/diagnostic/${data.id}`);
    } catch {
      setError('Something went wrong. Please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-6 py-16">
      <h1 className="text-2xl font-bold text-gray-900">Run a diagnostic</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label htmlFor="url" className="text-sm font-medium text-gray-700">
          Paste a YouTube, TikTok, or Instagram link
        </label>
        <input
          id="url"
          name="url"
          type="url"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.tiktok.com/@you/video/..."
          className="rounded-lg border border-gray-300 px-4 py-2"
        />
        <button
          type="submit"
          disabled={submitting}
          className="rounded-full bg-indigo-600 px-6 py-3 font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {submitting ? 'Analyzing…' : 'Get my report'}
        </button>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
      </form>
    </main>
  );
}
