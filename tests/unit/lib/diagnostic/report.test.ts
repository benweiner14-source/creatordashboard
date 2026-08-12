import { describe, it, expect } from 'vitest';
import { generateDiagnosticReport } from '@/lib/diagnostic/report';
import { createFakeClaudeReportClient } from '../../../fakes/claude.fake';

describe('generateDiagnosticReport', () => {
  it('combines scoring, the Claude client, and glossary linking into a full report', async () => {
    const claudeClient = createFakeClaudeReportClient({
      headline: 'Strong hook, watch your pacing',
      explanation: 'Your hook rate is strong and your retention looks solid for this format.',
    });

    const report = await generateDiagnosticReport({
      platform: 'tiktok',
      postStats: {
        captionOrTitle: 'How I hit 10k views overnight',
        publishedAt: '2026-08-11T19:00:00Z',
        durationSeconds: 28,
        viewCount: 12000,
        likeCount: 1000,
        commentCount: 150,
      },
      claudeClient,
    });

    expect(report.headline).toBe('Strong hook, watch your pacing');
    expect(report.scores.overallScore).toBeGreaterThan(0);
    expect(report.explanationSegments.some((s) => s.type === 'term')).toBe(true);
    expect(report.glossaryTerms.some((t) => t.slug === 'hook-rate')).toBe(true);
  });
});
