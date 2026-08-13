import { describe, it, expect, vi } from 'vitest';
import { handleDiagnosticRequest } from '@/lib/diagnostic/handler';
import { createInMemoryRateLimitStore } from '../../../fakes/rate-limit-store.fake';
import { createFakeYouTubeClient } from '../../../fakes/youtube.fake';
import { createFakeScraperClient } from '../../../fakes/scraper.fake';
import { createFakeClaudeReportClient } from '../../../fakes/claude.fake';

function makeDeps(overrides: Partial<Parameters<typeof handleDiagnosticRequest>[0]> = {}) {
  return {
    rateLimitStore: createInMemoryRateLimitStore(),
    youtubeClient: createFakeYouTubeClient(),
    scraperClient: createFakeScraperClient(),
    claudeClient: createFakeClaudeReportClient(),
    ipSalt: 'test-salt',
    saveDiagnostic: async () => ({ id: 'diagnostic-1' }),
    ...overrides,
  };
}

describe('handleDiagnosticRequest', () => {
  it('rejects requests without a signed-in profile', async () => {
    const result = await handleDiagnosticRequest(makeDeps(), {
      profileId: null,
      ip: '203.0.113.1',
      url: 'https://www.youtube.com/watch?v=abc123',
    });
    expect(result.status).toBe(401);
  });

  it('returns a generated report for a valid YouTube URL', async () => {
    const result = await handleDiagnosticRequest(makeDeps(), {
      profileId: 'profile-1',
      ip: '203.0.113.1',
      url: 'https://www.youtube.com/watch?v=abc123',
    });
    expect(result.status).toBe(200);
    expect(result.body.id).toBe('diagnostic-1');
  });

  it('returns a generated report for a valid TikTok URL', async () => {
    const result = await handleDiagnosticRequest(makeDeps(), {
      profileId: 'profile-1',
      ip: '203.0.113.1',
      url: 'https://www.tiktok.com/@user/video/123',
    });
    expect(result.status).toBe(200);
  });

  it('threads the scraper client\'s shareCount/saveCount through to the report', async () => {
    const baselineDeps = makeDeps({
      scraperClient: createFakeScraperClient({ likeCount: 200, commentCount: 100 }),
    });
    const baseline = await handleDiagnosticRequest(baselineDeps, {
      profileId: 'profile-1',
      ip: '203.0.113.1',
      url: 'https://www.tiktok.com/@user/video/123',
    });
    const shareHeavyDeps = makeDeps({
      scraperClient: createFakeScraperClient({ likeCount: 200, commentCount: 100, shareCount: 500, saveCount: 500 }),
    });
    const shareHeavy = await handleDiagnosticRequest(shareHeavyDeps, {
      profileId: 'profile-2',
      ip: '203.0.113.2',
      url: 'https://www.tiktok.com/@user/video/123',
    });

    const baselineScore = (baseline.body.report as { scores: { hookStrength: { score: number } } }).scores
      .hookStrength.score;
    const shareHeavyScore = (shareHeavy.body.report as { scores: { hookStrength: { score: number } } }).scores
      .hookStrength.score;
    expect(shareHeavyScore).toBeGreaterThan(baselineScore);
  });

  it('rejects an unsupported URL', async () => {
    const result = await handleDiagnosticRequest(makeDeps(), {
      profileId: 'profile-1',
      ip: '203.0.113.1',
      url: 'https://example.com/post',
    });
    expect(result.status).toBe(400);
  });

  it('rate-limits a second request from the same profile within 30 days', async () => {
    const deps = makeDeps();
    await handleDiagnosticRequest(deps, {
      profileId: 'profile-1',
      ip: '203.0.113.1',
      url: 'https://www.youtube.com/watch?v=abc123',
    });
    const second = await handleDiagnosticRequest(deps, {
      profileId: 'profile-1',
      ip: '203.0.113.1',
      url: 'https://www.youtube.com/watch?v=abc123',
    });
    expect(second.status).toBe(429);
  });

  it('never calls the paid external clients once the request is rate-limited', async () => {
    const fakeYouTubeClient = createFakeYouTubeClient();
    const fakeScraperClient = createFakeScraperClient();
    const fakeClaudeClient = createFakeClaudeReportClient();
    const youtubeClient = {
      ...fakeYouTubeClient,
      getVideoMetadata: vi.fn(fakeYouTubeClient.getVideoMetadata),
    };
    const scraperClient = {
      ...fakeScraperClient,
      fetchPost: vi.fn(fakeScraperClient.fetchPost),
    };
    const claudeClient = {
      ...fakeClaudeClient,
      generateDiagnosticReport: vi.fn(fakeClaudeClient.generateDiagnosticReport),
    };

    const deps = makeDeps({ youtubeClient, scraperClient, claudeClient });

    await handleDiagnosticRequest(deps, {
      profileId: 'profile-1',
      ip: '203.0.113.1',
      url: 'https://www.youtube.com/watch?v=abc123',
    });

    youtubeClient.getVideoMetadata.mockClear();
    scraperClient.fetchPost.mockClear();
    claudeClient.generateDiagnosticReport.mockClear();

    const second = await handleDiagnosticRequest(deps, {
      profileId: 'profile-1',
      ip: '203.0.113.1',
      url: 'https://www.youtube.com/watch?v=abc123',
    });

    expect(second.status).toBe(429);
    expect(youtubeClient.getVideoMetadata).not.toHaveBeenCalled();
    expect(scraperClient.fetchPost).not.toHaveBeenCalled();
    expect(claudeClient.generateDiagnosticReport).not.toHaveBeenCalled();
  });

  it('records the rate-limit event before calling any external API', async () => {
    const store = createInMemoryRateLimitStore();
    const callOrder: string[] = [];
    const originalCheckAndRecord = store.checkAndRecordAtomically;
    store.checkAndRecordAtomically = async (...args: Parameters<typeof originalCheckAndRecord>) => {
      callOrder.push('checkAndRecord');
      return originalCheckAndRecord(...args);
    };
    const fakeYouTubeClient = createFakeYouTubeClient();
    const youtubeClient = {
      ...fakeYouTubeClient,
      getVideoMetadata: async (...args: Parameters<typeof fakeYouTubeClient.getVideoMetadata>) => {
        callOrder.push('youtube');
        return fakeYouTubeClient.getVideoMetadata(...args);
      },
    };
    const deps = makeDeps({ rateLimitStore: store, youtubeClient });

    await handleDiagnosticRequest(deps, {
      profileId: 'profile-1',
      ip: '203.0.113.1',
      url: 'https://www.youtube.com/watch?v=abc123',
    });

    expect(callOrder).toEqual(['checkAndRecord', 'youtube']);
  });

  it('releases the rate-limit event when report generation fails, so the slot is not consumed', async () => {
    const store = createInMemoryRateLimitStore();
    const claudeClient = {
      generateDiagnosticReport: async () => {
        throw new Error('Claude API request failed');
      },
    };
    const deps = makeDeps({ rateLimitStore: store, claudeClient });

    await expect(
      handleDiagnosticRequest(deps, {
        profileId: 'profile-1',
        ip: '203.0.113.1',
        url: 'https://www.youtube.com/watch?v=abc123',
      })
    ).rejects.toThrow('Claude API request failed');

    const second = await handleDiagnosticRequest(makeDeps({ rateLimitStore: store }), {
      profileId: 'profile-1',
      ip: '203.0.113.1',
      url: 'https://www.youtube.com/watch?v=abc123',
    });
    expect(second.status).toBe(200);
  });

  it('releases the rate-limit event when the URL is unsupported, so the slot is not consumed', async () => {
    const store = createInMemoryRateLimitStore();

    const first = await handleDiagnosticRequest(makeDeps({ rateLimitStore: store }), {
      profileId: 'profile-1',
      ip: '203.0.113.1',
      url: 'https://example.com/post',
    });
    expect(first.status).toBe(400);

    const second = await handleDiagnosticRequest(makeDeps({ rateLimitStore: store }), {
      profileId: 'profile-1',
      ip: '203.0.113.1',
      url: 'https://www.youtube.com/watch?v=abc123',
    });
    expect(second.status).toBe(200);
  });
});
