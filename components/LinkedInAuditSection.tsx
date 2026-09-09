'use client';

import { useEffect, useState } from 'react';

interface LinkedInAuditHistoryItem {
  id: string;
  headline: string;
  workingWell: string[];
  needsWork: string[];
  createdAt: string;
}

type AuditSectionState =
  | { status: 'loading' }
  | { status: 'idle'; history: LinkedInAuditHistoryItem[] }
  | { status: 'submitting'; history: LinkedInAuditHistoryItem[] }
  | { status: 'error'; error: string; history: LinkedInAuditHistoryItem[] };

export function LinkedInAuditSection() {
  const [state, setState] = useState<AuditSectionState>({ status: 'loading' });
  const [latestResult, setLatestResult] = useState<LinkedInAuditHistoryItem | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/linkedin/audit')
      .then(async (res) => {
        if (cancelled) return;
        const data = await res.json();
        setState({ status: 'idle', history: data.history ?? [] });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error', error: "We couldn't load your past audits.", history: [] });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const history = state.status === 'loading' ? [] : state.history;
    setState({ status: 'submitting', history });

    const formData = new FormData();
    formData.append('pdf', file);

    try {
      const response = await fetch('/api/linkedin/audit', { method: 'POST', body: formData });
      const data = await response.json();
      if (!response.ok) {
        setState({ status: 'error', error: data.error ?? 'Something went wrong running your audit.', history });
        return;
      }
      setLatestResult(data.audit);
      setState({ status: 'idle', history: [data.audit, ...history] });
    } catch {
      setState({ status: 'error', error: "We couldn't reach the server. Check your connection and try again.", history });
    }
  }

  const history = state.status === 'loading' ? [] : state.history;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-bold text-gray-900">Profile audit</h2>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-gray-700">
        <li>Go to your own LinkedIn profile page.</li>
        <li>On a Mac, press Cmd+P. On Windows, press Ctrl+P.</li>
        <li>Where it asks for a printer, choose &quot;Save as PDF&quot; instead.</li>
        <li>Upload that file below.</li>
      </ol>
      <p className="text-xs text-gray-500">We read it, give you feedback, then delete it — we don&apos;t keep a copy of your profile.</p>

      <label htmlFor="linkedin-audit-upload" className="text-sm font-medium text-gray-700">
        Upload your profile PDF
      </label>
      <input
        id="linkedin-audit-upload"
        type="file"
        accept="application/pdf"
        onChange={handleFileChange}
        disabled={state.status === 'submitting'}
      />

      {state.status === 'submitting' && <p className="text-gray-600">Reading your profile…</p>}
      {state.status === 'error' && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}

      {latestResult && (
        <div className="rounded-lg border border-gray-200 p-4">
          <p className="font-semibold text-gray-900">{latestResult.headline}</p>
          <div className="mt-2">
            <h3 className="text-sm font-semibold text-gray-700">Working well</h3>
            <ul className="list-disc pl-5 text-sm text-gray-800">
              {latestResult.workingWell.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div className="mt-2">
            <h3 className="text-sm font-semibold text-gray-700">Needs work</h3>
            <ul className="list-disc pl-5 text-sm text-gray-800">
              {latestResult.needsWork.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Past audits</h3>
          <ul className="mt-2 flex flex-col gap-1 text-sm text-gray-600">
            {history.map((item) => (
              <li key={item.id}>{item.headline}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
