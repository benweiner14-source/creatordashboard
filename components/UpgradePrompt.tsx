'use client';

import { useState } from 'react';

export interface UpgradePromptProps {
  title: string;
  body: string;
  children?: React.ReactNode;
}

export function UpgradePrompt({ title, body, children }: UpgradePromptProps) {
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
    <div className="overflow-hidden rounded-[18px] border border-[#e8e8ee] bg-white shadow-[0_1px_2px_rgba(17,24,39,.04)]">
      <div className="h-1 bg-brand" />
      <div className="flex flex-col gap-4 px-7 py-[26px]">
        <span className="inline-flex w-fit whitespace-nowrap rounded-full border border-gray-200 px-3 py-1 font-mono text-[11px] uppercase tracking-[.14em] text-gray-500">
          Free plan
        </span>
        <h2 className="font-heading text-[26px] font-bold leading-[1.1] text-gray-900">{title}</h2>
        <p className="text-[15px] leading-[1.55] text-gray-600">{body}</p>
        {children}
        <button
          type="button"
          onClick={startCheckout}
          disabled={submitting}
          className="self-start rounded-full bg-brand px-6 py-[13px] font-semibold text-white disabled:opacity-50"
        >
          {submitting ? 'Redirecting…' : 'Upgrade — $10/mo'}
        </button>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
