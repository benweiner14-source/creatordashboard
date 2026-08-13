import { scoreHookStrength, type HookStrengthInput } from './hook-strength';
import { scoreRetentionRisk, type RetentionRiskInput } from './retention-risk';
import { scoreTiming, type TimingInput } from './timing';
import { scoreFormatFit, type FormatFitInput } from './format-fit';
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
}

export interface GenerateDiagnosticReportParams {
  platform: 'youtube' | 'tiktok' | 'instagram';
  postStats: DiagnosticPostStats;
  claudeClient: ClaudeReportClient;
}

export interface DiagnosticReport {
  scores: CombinedScore;
  headline: string;
  explanationSegments: GlossarySegment[];
  glossaryTerms: GlossaryTerm[];
}

export async function generateDiagnosticReport(params: GenerateDiagnosticReportParams): Promise<DiagnosticReport> {
  const { platform, postStats } = params;

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

  const scores = combineScores({
    hookStrength: scoreHookStrength(hookStrengthInput),
    retentionRisk: scoreRetentionRisk(retentionRiskInput),
    timing: scoreTiming(timingInput),
    formatFit: scoreFormatFit(formatFitInput),
  });

  const generated = await params.claudeClient.generateDiagnosticReport({
    platform,
    postSummary: postStats.captionOrTitle,
    scores: {
      hookStrength: { value: scores.hookStrength.score, label: scores.hookStrength.label },
      retentionRisk: { value: scores.retentionRisk.score, label: scores.retentionRisk.label },
      timing: { value: scores.timing.score, label: scores.timing.label },
      formatFit: { value: scores.formatFit.score, label: scores.formatFit.label },
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
  };
}
