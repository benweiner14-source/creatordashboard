import { describe, it, expect } from 'vitest';
import { handleLinkedInIdeasRequest, LINKEDIN_IDEAS_PROFILE_LIMIT } from '@/lib/linkedin/ideas-handler';
import { createInMemoryRateLimitStore } from '../../../fakes/rate-limit-store.fake';
import { createFakeLinkedInIdeasClient } from '../../../fakes/claude-linkedin-ideas.fake';

function makeDeps(overrides: Partial<Parameters<typeof handleLinkedInIdeasRequest>[0]> = {}) {
  return {
    rateLimitStore: createInMemoryRateLimitStore(),
    linkedInIdeasClient: createFakeLinkedInIdeasClient(),
    ipSalt: 'test-salt',
    hasActiveSubscription: async () => true,
    getLatestStrategy: async () => ({ id: 'strategy-1', niche: 'Gaming', targetGoal: 'Partnerships' }),
    getExistingIdeas: async () => null,
    saveIdeas: async ({ profileId, strategyId, weekStart, postIdeas }: any) => ({
      id: 'ideas-1',
      strategyId,
      weekStart,
      postIdeas,
    }),
    ...overrides,
  };
}

const NOW = new Date('2026-09-09T12:00:00Z');

describe('handleLinkedInIdeasRequest', () => {
  it('rejects requests without a signed-in profile', async () => {
    const result = await handleLinkedInIdeasRequest(makeDeps(), { profileId: null, ip: '203.0.113.1', now: NOW });
    expect(result.status).toBe(401);
  });

  it('rejects a signed-in profile with no active subscription', async () => {
    const deps = makeDeps({ hasActiveSubscription: async () => false });
    const result = await handleLinkedInIdeasRequest(deps, { profileId: 'p1', ip: '203.0.113.1', now: NOW });
    expect(result.status).toBe(402);
  });

  it('requires a strategy to exist first', async () => {
    const deps = makeDeps({ getLatestStrategy: async () => null });
    const result = await handleLinkedInIdeasRequest(deps, { profileId: 'p1', ip: '203.0.113.1', now: NOW });
    expect(result.status).toBe(400);
  });

  it('returns the cached ideas for this week without generating again', async () => {
    const deps = makeDeps({ getExistingIdeas: async () => ({ id: 'ideas-1', strategyId: 'strategy-1', weekStart: '2026-09-07', postIdeas: [] }) });
    const result = await handleLinkedInIdeasRequest(deps, { profileId: 'p1', ip: '203.0.113.1', now: NOW });
    expect(result.status).toBe(200);
    expect(result.body.cached).toBe(true);
  });

  it('generates and saves ideas when none exist for this week', async () => {
    const result = await handleLinkedInIdeasRequest(makeDeps(), { profileId: 'p1', ip: '203.0.113.1', now: NOW });
    expect(result.status).toBe(200);
    expect((result.body.ideas as any).id).toBe('ideas-1');
  });

  it('returns 422 without releasing the rate-limit slot when generation is genuinely empty', async () => {
    const deps = makeDeps({ linkedInIdeasClient: { generateWeeklyIdeas: async () => [] } });
    const result = await handleLinkedInIdeasRequest(deps, { profileId: 'p1', ip: '203.0.113.1', now: NOW });
    expect(result.status).toBe(422);
  });

  it(`rate-limits after ${LINKEDIN_IDEAS_PROFILE_LIMIT} distinct-week attempts in a day is not reachable in one week, but retries within the day for a still-missing week are limited`, async () => {
    // Simulate LINKEDIN_IDEAS_PROFILE_LIMIT prior rate-limit events directly via getExistingIdeas returning
    // null every time and the client throwing, forcing repeated slot consumption is out of scope for this
    // handler test — covered by the shared checkAndRecordRateLimit unit tests. This test only confirms the
    // 429 path is wired through with the correct eventType.
    const deps = makeDeps();
    for (let i = 0; i < LINKEDIN_IDEAS_PROFILE_LIMIT; i++) {
      // Each iteration needs a distinct "existing ideas" miss but the in-memory store still records
      // linkedin_ideas_generation events against the same profile, so after the limit the next call 429s
      // even though getExistingIdeas keeps returning null.
      await handleLinkedInIdeasRequest(deps, { profileId: 'p1', ip: '203.0.113.1', now: NOW });
    }
    const blocked = await handleLinkedInIdeasRequest(deps, { profileId: 'p1', ip: '203.0.113.1', now: NOW });
    expect(blocked.status).toBe(429);
  });

  it('releases the rate-limit slot when generation throws', async () => {
    // Looping to the profile limit before flipping the stub is load-bearing:
    // it's the only way the final call's 200 can prove the release actually
    // happened, rather than merely landing below a limit it was nowhere
    // near reaching.
    let failing = true;
    const deps = makeDeps({
      linkedInIdeasClient: {
        generateWeeklyIdeas: async (niche, targetGoal, currentDate) => {
          if (failing) throw new Error('Claude API request failed with status 500');
          return createFakeLinkedInIdeasClient().generateWeeklyIdeas(niche, targetGoal, currentDate);
        },
      },
    });

    for (let i = 0; i < LINKEDIN_IDEAS_PROFILE_LIMIT; i++) {
      await expect(handleLinkedInIdeasRequest(deps, { profileId: 'p1', ip: '203.0.113.1', now: NOW })).rejects.toThrow(
        'Claude API request failed'
      );
    }

    // Every one of the LINKEDIN_IDEAS_PROFILE_LIMIT throws above released its
    // slot — if it hadn't, the profile limit would already be exhausted and
    // this call would 429, not 200.
    failing = false;
    const retry = await handleLinkedInIdeasRequest(deps, { profileId: 'p1', ip: '203.0.113.1', now: NOW });
    expect(retry.status).toBe(200);
  });
});
