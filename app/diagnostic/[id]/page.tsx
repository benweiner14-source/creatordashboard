'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { AppNav } from '@/components/AppNav';
import { GlossaryText } from '@/components/GlossaryChip';
import { Banner } from '@/components/Banner';
import { OverallScoreRing } from '@/components/OverallScoreRing';

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
    return (
      <>
        <AppNav />
        <p role="alert">{error}</p>
      </>
    );
  }

  if (!diagnostic) {
    return (
      <>
        <AppNav />
        <p>Loading your report…</p>
      </>
    );
  }

  const { report } = diagnostic;

  return (
    <>
      <AppNav />
      <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
      <article className="motion-safe:animate-card-establish rounded-[18px] border border-[#e8e8ee] bg-white px-[30px] py-7">
        <h1 className="font-heading text-2xl font-bold leading-tight text-gray-900">{report.headline}</h1>
        {report.confidenceCaveat && (
          <div className="mt-5">
            <Banner variant="caution" label="Low confidence">
              {report.confidenceCaveat}
            </Banner>
          </div>
        )}
        <div className="motion-safe:animate-hud-resolve mt-6">
          <OverallScoreRing value={report.scores.overallScore} />
        </div>
        <div className="motion-safe:animate-support-reveal mt-6 text-base leading-relaxed text-gray-800">
          <GlossaryText text={report.explanationSegments.map((s) => s.value).join('')} />
        </div>
      </article>

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
            className="self-start rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {enriching
              ? 'Analyzing your first 5 seconds…'
              : diagnostic.visualAudioStatus === 'pending'
                ? 'Analysis may have been interrupted — try again'
                : 'See how your first 5 seconds actually look'}
          </button>
        )}

      {enrichBlocked &&
        (enrichBlocked.upgradeUrl ? (
          <Banner variant="promo" label="Locked">
            <p>{enrichBlocked.message}</p>
            <a
              href={enrichBlocked.upgradeUrl}
              className="mt-2 inline-block rounded-full bg-brand px-[18px] py-[9px] text-[13px] font-semibold text-white"
            >
              Upgrade to unlock this analysis
            </a>
          </Banner>
        ) : (
          <Banner variant="caution" label="Can't run this yet">
            {enrichBlocked.message}
          </Banner>
        ))}

      {diagnostic.visualAudioStatus === 'complete' && diagnostic.visualAudioNarrative && (
        <Banner variant="positive" label="Complete">
          <p className="mb-1 font-semibold text-gray-900">Your first 5 seconds, visually</p>
          <p>{diagnostic.visualAudioNarrative}</p>
          {diagnostic.visualAudioIsEpisodic && (
            <p className="mt-2 inline-block whitespace-nowrap rounded-md border border-[#a7f3d0] bg-[#d1fae5] px-2 py-1 font-mono text-[10px] uppercase tracking-[.12em] text-[#047857]">
              📺 Part of a series{diagnostic.visualAudioSeriesLabel ? `: ${diagnostic.visualAudioSeriesLabel}` : ''}
            </p>
          )}
        </Banner>
      )}

      {diagnostic.visualAudioStatus === 'failed' && (
        <Banner variant="critical" label="Analysis failed" role="alert">
          <p>{enrichError ?? "Couldn't analyze this video."}</p>
          <button
            type="button"
            onClick={handleEnrich}
            disabled={enriching}
            className="mt-2 font-semibold text-[#b91c1c] underline"
          >
            Try again
          </button>
        </Banner>
      )}

      {diagnostic.platform !== 'youtube' &&
        !commentAnalysisBlocked &&
        (!diagnostic.commentAnalysisStatus || diagnostic.commentAnalysisStatus === 'pending') && (
          <button
            type="button"
            onClick={handleAnalyzeComments}
            disabled={analyzingComments}
            className="self-start rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {analyzingComments
              ? 'Reading your top comments…'
              : diagnostic.commentAnalysisStatus === 'pending'
                ? 'Analysis may have been interrupted — try again'
                : 'See what your audience is actually saying'}
          </button>
        )}

      {commentAnalysisBlocked &&
        (commentAnalysisBlocked.upgradeUrl ? (
          <Banner variant="promo" label="Locked">
            <p>{commentAnalysisBlocked.message}</p>
            <a
              href={commentAnalysisBlocked.upgradeUrl}
              className="mt-2 inline-block rounded-full bg-brand px-[18px] py-[9px] text-[13px] font-semibold text-white"
            >
              Upgrade to unlock this analysis
            </a>
          </Banner>
        ) : (
          <Banner variant="caution" label="Can't run this yet">
            {commentAnalysisBlocked.message}
          </Banner>
        ))}

      {diagnostic.commentAnalysisStatus === 'complete' && diagnostic.commentAnalysisNarrative && (
        <Banner variant="positive" label="Complete">
          <p className="mb-1 font-semibold text-gray-900">What your audience is saying</p>
          <p>{diagnostic.commentAnalysisNarrative}</p>
          {diagnostic.commentAnalysisHasContentRequest && diagnostic.commentAnalysisContentRequestSummary && (
            <p className="mt-2 font-mono text-[11px] leading-[1.45] text-gray-600">
              💡 Content idea from comments: {diagnostic.commentAnalysisContentRequestSummary}
            </p>
          )}
        </Banner>
      )}

      {diagnostic.commentAnalysisStatus === 'failed' && (
        <Banner variant="critical" label="Analysis failed" role="alert">
          <p>{commentAnalysisError ?? "Couldn't analyze these comments."}</p>
          <button
            type="button"
            onClick={handleAnalyzeComments}
            disabled={analyzingComments}
            className="mt-2 font-semibold text-[#b91c1c] underline"
          >
            Try again
          </button>
        </Banner>
      )}
      </main>
    </>
  );
}
