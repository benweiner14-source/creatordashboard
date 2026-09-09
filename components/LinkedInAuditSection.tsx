'use client';

import { useEffect, useState } from 'react';
import { GlossaryText } from '@/components/GlossaryChip';

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
        if (!res.ok) {
          // Without this, a 401/402/500 silently renders as "no past audits",
          // which reads as "you've never run one" rather than "we couldn't
          // check".
          setState({ status: 'error', error: data.error ?? "We couldn't load your past audits.", history: [] });
          return;
        }
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
    // Clear the input so re-picking the identical file still fires onChange —
    // otherwise a retry after a failed audit silently does nothing.
    event.target.value = '';
    if (!file) return;
    const history = state.status === 'loading' ? [] : state.history;
    setState({ status: 'submitting', history });

    const formData = new FormData();
    formData.append('pdf', file);

    try {
      const response = await fetch('/api/linkedin/audit', { method: 'POST', body: formData });
      // The hosting platform rejects an oversized body with a non-JSON 413
      // before this route runs, so `response.json()` can throw on a response
      // we did in fact receive.
      let data: { audit?: LinkedInAuditHistoryItem; error?: string };
      try {
        data = await response.json();
      } catch {
        setState({
          status: 'error',
          error: response.ok
            ? 'Something went wrong running your audit. Please try again.'
            : "We couldn't run your audit — the file may be too large (4MB max). Try exporting just your profile page.",
          history,
        });
        return;
      }
      if (!response.ok || !data.audit) {
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
  // A just-submitted audit is prepended to `history` AND rendered in full as
  // `latestResult`, so drop the head to stop it appearing twice — same rule as
  // the strategy section's `history.slice(1)`. On first load there is no
  // `latestResult` covering history[0], so the whole list stands.
  const pastAudits = latestResult ? history.slice(1) : history;

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
          <p className="font-semibold text-gray-900">
            <GlossaryText text={latestResult.headline} />
          </p>
          <div className="mt-2">
            <h3 className="text-sm font-semibold text-gray-700">Working well</h3>
            <ul className="list-disc pl-5 text-sm text-gray-800">
              {latestResult.workingWell.map((item, index) => (
                <li key={index}>
                  <GlossaryText text={item} />
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-2">
            <h3 className="text-sm font-semibold text-gray-700">Needs work</h3>
            <ul className="list-disc pl-5 text-sm text-gray-800">
              {latestResult.needsWork.map((item, index) => (
                <li key={index}>
                  <GlossaryText text={item} />
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {pastAudits.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Past audits</h3>
          <ul className="mt-2 flex flex-col gap-1 text-sm text-gray-600">
            {pastAudits.map((item) => (
              <li key={item.id}>{item.headline}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
