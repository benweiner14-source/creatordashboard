'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { isSafeRelativePath } from '@/lib/auth/callback';

export default function MfaChallengePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawNext = searchParams.get('next');
  const next = rawNext && isSafeRelativePath(rawNext) ? rawNext : '/home';
  const [code, setCode] = useState('');
  const [factorId, setFactorId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch('/api/settings/mfa/factors')
      .then((res) => res.json())
      .then((data) => setFactorId(data.factorId ?? null))
      .catch(() => {});
  }, []);

  async function resolveFactorId(): Promise<string | null> {
    if (factorId) return factorId;
    const res = await fetch('/api/settings/mfa/factors');
    const data = await res.json().catch(() => ({}));
    const id = data.factorId ?? null;
    setFactorId(id);
    return id;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const id = await resolveFactorId();
    const res = await fetch('/api/settings/mfa/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ factorId: id, code }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Something went wrong. Please try again.');
      setSubmitting(false);
      return;
    }
    router.push(next);
  }

  return (
    <main className="mx-auto flex max-w-sm flex-col gap-4 px-6 py-16">
      <h1 className="text-2xl font-bold text-gray-900">Enter your verification code</h1>
      <p className="text-gray-600">Open your authenticator app and enter the current 6-digit code.</p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label htmlFor="mfa-code" className="text-sm font-medium text-gray-700">
          Verification code
        </label>
        <input
          id="mfa-code"
          type="text"
          inputMode="numeric"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="rounded-lg border border-gray-300 px-4 py-2"
        />
        <button
          type="submit"
          disabled={submitting}
          className="rounded-full bg-indigo-600 px-6 py-3 font-semibold text-white disabled:opacity-50"
        >
          Verify
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
