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

  it('threads shareCount/saveCount through to the hook-strength score for tiktok', async () => {
    const claudeClient = createFakeClaudeReportClient();
    const basePostStats = {
      captionOrTitle: 'Untitled',
      publishedAt: '2026-08-11T19:00:00Z',
      durationSeconds: 30,
      viewCount: 10000,
      likeCount: 200,
      commentCount: 100,
    };

    const baseline = await generateDiagnosticReport({ platform: 'tiktok', postStats: basePostStats, claudeClient });
    const shareHeavy = await generateDiagnosticReport({
      platform: 'tiktok',
      postStats: { ...basePostStats, shareCount: 500, saveCount: 500 },
      claudeClient,
    });

    expect(shareHeavy.scores.hookStrength.score).toBeGreaterThan(baseline.scores.hookStrength.score);
  });

  it('computes a Reach score when followerCount is provided', async () => {
    const claudeClient = createFakeClaudeReportClient();
    const report = await generateDiagnosticReport({
      platform: 'instagram',
      postStats: {
        captionOrTitle: 'Every change to the wanted system',
        publishedAt: '2026-08-29T04:00:00Z',
        durationSeconds: 20,
        viewCount: 34_000,
        likeCount: 500,
        commentCount: 12,
        followerCount: 5_400_000,
      },
      claudeClient,
    });

    expect(report.scores.reach).not.toBeNull();
    expect(report.scores.reach?.label).toBe('weak');
  });

  it('leaves Reach null when followerCount is not provided, and does not throw', async () => {
    const claudeClient = createFakeClaudeReportClient();
    const report = await generateDiagnosticReport({
      platform: 'tiktok',
      postStats: {
        captionOrTitle: 'Untitled',
        publishedAt: '2026-08-11T19:00:00Z',
        durationSeconds: 30,
        viewCount: 10000,
        likeCount: 200,
        commentCount: 100,
      },
      claudeClient,
    });

    expect(report.scores.reach).toBeNull();
  });

  it('leaves Reach null when followerCount is 0', async () => {
    const claudeClient = createFakeClaudeReportClient();
    const report = await generateDiagnosticReport({
      platform: 'tiktok',
      postStats: {
        captionOrTitle: 'Untitled',
        publishedAt: '2026-08-11T19:00:00Z',
        durationSeconds: 30,
        viewCount: 10000,
        likeCount: 200,
        commentCount: 100,
        followerCount: 0,
      },
      claudeClient,
    });

    expect(report.scores.reach).toBeNull();
  });
});
