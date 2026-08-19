'use client';

import { useState } from 'react';

export interface UpgradePromptProps {
  title: string;
  body: string;
}

export function UpgradePrompt({ title, body }: UpgradePromptProps) {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function startCheckout() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/billing/checkout', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.url) {
        setError(data.error ?? 'Something went wrong starting checkout.');
        setSubmitting(false);
        return;
      }
      window.location.href = data.url;
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-indigo-200 bg-indigo-50 p-6">
      <h2 className="text-xl font-bold text-gray-900">{title}</h2>
      <p className="text-gray-700">{body}</p>
      <button
        type="button"
        onClick={startCheckout}
        disabled={submitting}
        className="self-start rounded-full bg-indigo-600 px-6 py-3 font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {submitting ? 'Redirecting…' : 'Upgrade — $10/mo'}
      </button>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
