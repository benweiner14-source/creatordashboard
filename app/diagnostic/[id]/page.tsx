'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { GlossaryText } from '@/components/GlossaryChip';

interface DiagnosticReportData {
  headline: string;
  scores: { overallScore: number };
  explanationSegments: Array<{ type: 'text' | 'term'; value: string }>;
  confidenceCaveat?: string | null;
}

interface DiagnosticData {
  platform: 'youtube' | 'tiktok' | 'instagram';
  visualAudioStatus: 'pending' | 'complete' | 'failed' | null;
  visualAudioNarrative: string | null;
  report: DiagnosticReportData;
}

export default function DiagnosticReportPage() {
  const params = useParams<{ id: string }>();
  const [diagnostic, setDiagnostic] = useState<DiagnosticData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enriching, setEnriching] = useState(false);
  const [enrichError, setEnrichError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/diagnostic/${params.id}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setError(data.error);
          return;
        }
        setDiagnostic({
          platform: data.diagnostic.platform,
          visualAudioStatus: data.diagnostic.visual_audio_status,
          visualAudioNarrative: data.diagnostic.visual_audio_narrative,
          report: data.diagnostic.report_json,
        });
      })
      .catch(() => {
        if (!cancelled) setError('Something went wrong loading your report. Please try again.');
      });
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  async function handleEnrich() {
    setEnriching(true);
    setEnrichError(null);
    try {
      const res = await fetch(`/api/diagnostic/${params.id}/enrich`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setEnrichError(data.error ?? 'Something went wrong analyzing this video. Please try again.');
        setDiagnostic((prev) => (prev ? { ...prev, visualAudioStatus: 'failed' } : prev));
        return;
      }
      setDiagnostic((prev) =>
        prev ? { ...prev, visualAudioStatus: 'complete', visualAudioNarrative: data.narrative } : prev
      );
    } catch {
      setEnrichError('Something went wrong analyzing this video. Please try again.');
      setDiagnostic((prev) => (prev ? { ...prev, visualAudioStatus: 'failed' } : prev));
    } finally {
      setEnriching(false);
    }
  }

  if (error) {
    return <p role="alert">{error}</p>;
  }

  if (!diagnostic) {
    return <p>Loading your report…</p>;
  }

  const { report } = diagnostic;

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
      <h1 className="text-2xl font-bold text-gray-900">{report.headline}</h1>
      {report.confidenceCaveat && (
        <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">{report.confidenceCaveat}</p>
      )}
      <p className="text-lg text-gray-700">Overall score: {report.scores.overallScore}</p>
      <div className="text-base leading-relaxed text-gray-800">
        <GlossaryText text={report.explanationSegments.map((s) => s.value).join('')} />
      </div>

      {diagnostic.platform === 'tiktok' && !diagnostic.visualAudioStatus && (
        <button
          type="button"
          onClick={handleEnrich}
          disabled={enriching}
          className="self-start rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {enriching ? 'Analyzing your first 5 seconds…' : 'See how your first 5 seconds actually look'}
        </button>
      )}

      {diagnostic.visualAudioStatus === 'complete' && diagnostic.visualAudioNarrative && (
        <div className="rounded-lg bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
          <p className="mb-1 font-semibold">Your first 5 seconds, visually</p>
          <p>{diagnostic.visualAudioNarrative}</p>
        </div>
      )}

      {diagnostic.visualAudioStatus === 'failed' && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
          <p>{enrichError ?? "Couldn't analyze this video."}</p>
          <button type="button" onClick={handleEnrich} disabled={enriching} className="mt-2 font-medium underline">
            Try again
          </button>
        </div>
      )}
    </main>
  );
}
