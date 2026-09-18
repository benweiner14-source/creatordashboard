'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { GlossaryText } from '@/components/GlossaryChip';

interface DiagnosticReportData {
  headline: string;
  scores: { overallScore: number };
  explanationSegments: Array<{ type: 'text' | 'term'; value: string }>;
  confidenceCaveat?: string | null;
}

/**
 * A non-2xx response that persisted nothing server-side (402 not subscribed,
 * 401 session expired, 422 unsupported platform). Deliberately kept separate
 * from `diagnostic.visualAudioStatus === 'failed'`, which means "the server
 * wrote a failed status" and is the only case a retry can fix.
 */
interface EnrichBlocked {
  message: string;
  upgradeUrl?: string;
}

interface DiagnosticData {
  platform: 'youtube' | 'tiktok' | 'instagram';
  visualAudioStatus: 'pending' | 'complete' | 'failed' | null;
  visualAudioNarrative: string | null;
  visualAudioIsEpisodic: boolean | null;
  visualAudioSeriesLabel: string | null;
  commentAnalysisStatus: 'pending' | 'complete' | 'failed' | null;
  commentAnalysisNarrative: string | null;
  commentAnalysisHasContentRequest: boolean | null;
  commentAnalysisContentRequestSummary: string | null;
  report: DiagnosticReportData;
}

export default function DiagnosticReportPage() {
  const params = useParams<{ id: string }>();
  const [diagnostic, setDiagnostic] = useState<DiagnosticData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enriching, setEnriching] = useState(false);
  const [enrichError, setEnrichError] = useState<string | null>(null);
  const [enrichBlocked, setEnrichBlocked] = useState<EnrichBlocked | null>(null);
  const [analyzingComments, setAnalyzingComments] = useState(false);
  const [commentAnalysisError, setCommentAnalysisError] = useState<string | null>(null);
  const [commentAnalysisBlocked, setCommentAnalysisBlocked] = useState<EnrichBlocked | null>(null);

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
          visualAudioIsEpisodic: data.diagnostic.visual_audio_is_episodic,
          visualAudioSeriesLabel: data.diagnostic.visual_audio_series_label,
          commentAnalysisStatus: data.diagnostic.comment_analysis_status,
          commentAnalysisNarrative: data.diagnostic.comment_analysis_narrative,
          commentAnalysisHasContentRequest: data.diagnostic.comment_analysis_has_content_request,
          commentAnalysisContentRequestSummary: data.diagnostic.comment_analysis_content_request_summary,
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
    setEnrichBlocked(null);
    try {
      const res = await fetch(`/api/diagnostic/${params.id}/enrich`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        // 402/401/422 all mean the server persisted nothing and a retry can't
        // help — they get their own message (and, for 402, an upgrade link)
        // rather than the "failed + Try again" treatment.
        if (res.status === 402) {
          setEnrichBlocked({
            message: data.error ?? 'Visual & Audio Analysis requires an active subscription.',
            upgradeUrl: data.upgradeUrl,
          });
          return;
        }
        if (res.status === 401) {
          setEnrichBlocked({ message: 'Your session has expired. Please sign in again to run this analysis.' });
          return;
        }
        if (res.status === 422) {
          setEnrichBlocked({ message: data.error ?? 'This analysis is not available for this platform yet.' });
          return;
        }
        setEnrichError(data.error ?? 'Something went wrong analyzing this video. Please try again.');
        setDiagnostic((prev) => (prev ? { ...prev, visualAudioStatus: 'failed' } : prev));
        return;
      }
      setDiagnostic((prev) =>
        prev
          ? {
              ...prev,
              visualAudioStatus: 'complete',
              visualAudioNarrative: data.narrative,
              visualAudioIsEpisodic: data.isEpisodic ?? null,
              visualAudioSeriesLabel: data.seriesLabel ?? null,
            }
          : prev
      );
    } catch {
      setEnrichError('Something went wrong analyzing this video. Please try again.');
      setDiagnostic((prev) => (prev ? { ...prev, visualAudioStatus: 'failed' } : prev));
    } finally {
      setEnriching(false);
    }
  }

  async function handleAnalyzeComments() {
    setAnalyzingComments(true);
    setCommentAnalysisError(null);
    setCommentAnalysisBlocked(null);
    try {
      const res = await fetch(`/api/diagnostic/${params.id}/comments`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 402) {
          setCommentAnalysisBlocked({
            message: data.error ?? 'Comment Analysis requires an active subscription.',
            upgradeUrl: data.upgradeUrl,
          });
          return;
        }
        if (res.status === 401) {
          setCommentAnalysisBlocked({ message: 'Your session has expired. Please sign in again to run this analysis.' });
          return;
        }
        setCommentAnalysisError(data.error ?? 'Something went wrong analyzing these comments. Please try again.');
        setDiagnostic((prev) => (prev ? { ...prev, commentAnalysisStatus: 'failed' } : prev));
        return;
      }
      setDiagnostic((prev) =>
        prev
          ? {
              ...prev,
              commentAnalysisStatus: 'complete',
              commentAnalysisNarrative: data.narrative,
              commentAnalysisHasContentRequest: data.hasContentRequest ?? null,
              commentAnalysisContentRequestSummary: data.contentRequestSummary ?? null,
            }
          : prev
      );
    } catch {
      setCommentAnalysisError('Something went wrong analyzing these comments. Please try again.');
      setDiagnostic((prev) => (prev ? { ...prev, commentAnalysisStatus: 'failed' } : prev));
    } finally {
      setAnalyzingComments(false);
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

      {/*
        'pending' is treated as retryable, not as "in progress": the analysis
        runs inside a single request, so a row still at 'pending' means that
        request died (e.g. the 60s function timeout) and nothing will ever
        write 'complete'/'failed'. Without this the section would render
        nothing at all, forever, on an analysis the user already paid for.
      */}
      {diagnostic.platform === 'tiktok' &&
        !enrichBlocked &&
        (!diagnostic.visualAudioStatus || diagnostic.visualAudioStatus === 'pending') && (
          <button
            type="button"
            onClick={handleEnrich}
            disabled={enriching}
            className="self-start rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {enriching
              ? 'Analyzing your first 5 seconds…'
              : diagnostic.visualAudioStatus === 'pending'
                ? 'Analysis may have been interrupted — try again'
                : 'See how your first 5 seconds actually look'}
          </button>
        )}

      {enrichBlocked && (
        <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p>{enrichBlocked.message}</p>
          {enrichBlocked.upgradeUrl && (
            <a href={enrichBlocked.upgradeUrl} className="mt-2 inline-block font-medium underline">
              Upgrade to unlock this analysis
            </a>
          )}
        </div>
      )}

      {diagnostic.visualAudioStatus === 'complete' && diagnostic.visualAudioNarrative && (
        <div className="rounded-lg bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
          <p className="mb-1 font-semibold">Your first 5 seconds, visually</p>
          <p>{diagnostic.visualAudioNarrative}</p>
          {diagnostic.visualAudioIsEpisodic && (
            <p className="mt-2 inline-block rounded-full bg-indigo-100 px-3 py-1 text-xs font-medium text-indigo-800">
              📺 Part of a series{diagnostic.visualAudioSeriesLabel ? `: ${diagnostic.visualAudioSeriesLabel}` : ''}
            </p>
          )}
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

      {diagnostic.platform !== 'youtube' &&
        !commentAnalysisBlocked &&
        (!diagnostic.commentAnalysisStatus || diagnostic.commentAnalysisStatus === 'pending') && (
          <button
            type="button"
            onClick={handleAnalyzeComments}
            disabled={analyzingComments}
            className="self-start rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {analyzingComments
              ? 'Reading your top comments…'
              : diagnostic.commentAnalysisStatus === 'pending'
                ? 'Analysis may have been interrupted — try again'
                : 'See what your audience is actually saying'}
          </button>
        )}

      {commentAnalysisBlocked && (
        <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p>{commentAnalysisBlocked.message}</p>
          {commentAnalysisBlocked.upgradeUrl && (
            <a href={commentAnalysisBlocked.upgradeUrl} className="mt-2 inline-block font-medium underline">
              Upgrade to unlock this analysis
            </a>
          )}
        </div>
      )}

      {diagnostic.commentAnalysisStatus === 'complete' && diagnostic.commentAnalysisNarrative && (
        <div className="rounded-lg bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
          <p className="mb-1 font-semibold">What your audience is saying</p>
          <p>{diagnostic.commentAnalysisNarrative}</p>
          {diagnostic.commentAnalysisHasContentRequest && diagnostic.commentAnalysisContentRequestSummary && (
            <p className="mt-2 inline-block rounded-full bg-indigo-100 px-3 py-1 text-xs font-medium text-indigo-800">
              💡 Content idea from comments: {diagnostic.commentAnalysisContentRequestSummary}
            </p>
          )}
        </div>
      )}

      {diagnostic.commentAnalysisStatus === 'failed' && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
          <p>{commentAnalysisError ?? "Couldn't analyze these comments."}</p>
          <button type="button" onClick={handleAnalyzeComments} disabled={analyzingComments} className="mt-2 font-medium underline">
            Try again
          </button>
        </div>
      )}
    </main>
  );
}
