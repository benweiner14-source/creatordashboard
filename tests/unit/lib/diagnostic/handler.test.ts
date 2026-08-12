import { describe, it, expect } from 'vitest';
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
});
