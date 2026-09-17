import { scoreHookStrength, type HookStrengthInput } from './hook-strength';
import { scoreRetentionRisk, type RetentionRiskInput } from './retention-risk';
import { scoreTiming, type TimingInput } from './timing';
import { scoreFormatFit, type FormatFitInput } from './format-fit';
import { scoreReach } from './reach';
import { combineScores, type CombinedScore } from './score';
import type { ClaudeReportClient } from '@/lib/integrations/claude';
import { linkGlossaryTerms, getGlossaryTerms, type GlossarySegment, type GlossaryTerm } from '@/lib/glossary';

export interface DiagnosticPostStats {
  captionOrTitle: string;
  publishedAt: string;
  durationSeconds: number;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  // Only ever populated for TikTok — see lib/integrations/scraper.ts.
  shareCount?: number;
  saveCount?: number;
  followerCount?: number;
}

export interface GenerateDiagnosticReportParams {
  platform: 'youtube' | 'tiktok' | 'instagram';
  postStats: DiagnosticPostStats;
  claudeClient: ClaudeReportClient;
  /** Injectable for tests — defaults to the real current time. */
  now?: Date;
}

export interface DiagnosticReport {
  scores: CombinedScore;
  headline: string;
  explanationSegments: GlossarySegment[];
  glossaryTerms: GlossaryTerm[];
  confidenceCaveat: string | null;
}

// Not sourced research — a judgment call, like several other unsourced
// thresholds in this app (see docs/superpowers/specs/2026-08-13-diagnostic-benchmark-sources.md).
// A post this fresh hasn't accumulated a representative sample: early
// engagers skew toward superfans, so the same raw numbers that would be a
// reliable read on a mature post can be noise here. Deliberately a caveat,
// not a blocker or a change to the actual scores — the creator asked for a
// read on this specific post right now, and the scores are still the most
// honest number available; only the interpretation needs the caveat.
const MIN_RELIABLE_AGE_HOURS = 3;

function computeConfidenceCaveat(publishedAt: string, now: Date): string | null {
  const ageHours = (now.getTime() - new Date(publishedAt).getTime()) / (1000 * 60 * 60);
  if (ageHours >= MIN_RELIABLE_AGE_HOURS) return null;
  return `This post is less than ${MIN_RELIABLE_AGE_HOURS} hours old — early view/like counts can be misleading (skewed toward your most engaged followers). Treat these scores as a preliminary read, and consider re-running the diagnostic in a few hours for a more reliable picture.`;
}

export async function generateDiagnosticReport(params: GenerateDiagnosticReportParams): Promise<DiagnosticReport> {
  const { platform, postStats } = params;
  const now = params.now ?? new Date();

  const hookStrengthInput: HookStrengthInput = {
    platform,
    captionOrTitle: postStats.captionOrTitle,
    viewCount: postStats.viewCount,
    likeCount: postStats.likeCount,
    commentCount: postStats.commentCount,
    shareCount: postStats.shareCount,
    saveCount: postStats.saveCount,
  };
  const retentionRiskInput: RetentionRiskInput = {
    platform,
    durationSeconds: postStats.durationSeconds,
    viewCount: postStats.viewCount,
    likeCount: postStats.likeCount,
    commentCount: postStats.commentCount,
  };
  const timingInput: TimingInput = { platform, publishedAt: postStats.publishedAt };
  const formatFitInput: FormatFitInput = { platform, durationSeconds: postStats.durationSeconds };

  const reach =
    postStats.followerCount && postStats.followerCount > 0
      ? scoreReach({ viewCount: postStats.viewCount, followerCount: postStats.followerCount })
      : null;

  const scores = combineScores({
    hookStrength: scoreHookStrength(hookStrengthInput),
    retentionRisk: scoreRetentionRisk(retentionRiskInput),
    timing: scoreTiming(timingInput),
    formatFit: scoreFormatFit(formatFitInput),
    reach,
  });

  const generated = await params.claudeClient.generateDiagnosticReport({
    platform,
    postSummary: postStats.captionOrTitle,
    scores: {
      hookStrength: { value: scores.hookStrength.score, label: scores.hookStrength.label },
      retentionRisk: { value: scores.retentionRisk.score, label: scores.retentionRisk.label },
      timing: { value: scores.timing.score, label: scores.timing.label },
      formatFit: { value: scores.formatFit.score, label: scores.formatFit.label },
      ...(scores.reach ? { reach: { value: scores.reach.score, label: scores.reach.label } } : {}),
    },
  });

  const allTerms = getGlossaryTerms();
  const explanationSegments = linkGlossaryTerms(generated.explanation, allTerms);
  const glossaryTerms = allTerms.filter((term) =>
    explanationSegments.some((segment) => segment.type === 'term' && segment.term.slug === term.slug)
  );

  return {
    scores,
    headline: generated.headline,
    explanationSegments,
    glossaryTerms,
    confidenceCaveat: computeConfidenceCaveat(postStats.publishedAt, now),
  };
}
