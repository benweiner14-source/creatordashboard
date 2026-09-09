import { describe, it, expect } from 'vitest';
import { handleLinkedInStrategyRequest, LINKEDIN_STRATEGY_PROFILE_LIMIT } from '@/lib/linkedin/strategy-handler';
import { createInMemoryRateLimitStore } from '../../../fakes/rate-limit-store.fake';
import { createFakeLinkedInStrategyClient } from '../../../fakes/claude-linkedin-strategy.fake';

function makeDeps(overrides: Partial<Parameters<typeof handleLinkedInStrategyRequest>[0]> = {}) {
  return {
    rateLimitStore: createInMemoryRateLimitStore(),
    linkedInStrategyClient: createFakeLinkedInStrategyClient(),
    ipSalt: 'test-salt',
    hasActiveSubscription: async () => true,
    saveStrategy: async ({ profileId, niche, targetGoal, strategy }: any) => ({
      id: 'strategy-1',
      niche,
      targetGoal,
      createdAt: '2026-09-09T00:00:00Z',
      ...strategy,
    }),
    ...overrides,
  };
}

describe('handleLinkedInStrategyRequest', () => {
  it('rejects requests without a signed-in profile', async () => {
    const result = await handleLinkedInStrategyRequest(makeDeps(), { profileId: null, ip: '203.0.113.1', niche: 'Gaming', targetGoal: 'Partnerships' });
    expect(result.status).toBe(401);
  });

  it('rejects a signed-in profile with no active subscription', async () => {
    const deps = makeDeps({ hasActiveSubscription: async () => false });
    const result = await handleLinkedInStrategyRequest(deps, { profileId: 'p1', ip: '203.0.113.1', niche: 'Gaming', targetGoal: 'Partnerships' });
    expect(result.status).toBe(402);
    expect(result.body.upgradeUrl).toBe('/billing');
  });

  it('rejects a missing niche or goal', async () => {
    const result = await handleLinkedInStrategyRequest(makeDeps(), { profileId: 'p1', ip: '203.0.113.1', niche: '', targetGoal: 'Partnerships' });
    expect(result.status).toBe(400);
  });

  it('returns a generated strategy on success', async () => {
    const result = await handleLinkedInStrategyRequest(makeDeps(), { profileId: 'p1', ip: '203.0.113.1', niche: 'Gaming', targetGoal: 'Partnerships' });
    expect(result.status).toBe(200);
    expect((result.body.strategy as any).id).toBe('strategy-1');
  });

  it(`rate-limits after ${LINKEDIN_STRATEGY_PROFILE_LIMIT} requests from the same profile in a day`, async () => {
    const deps = makeDeps();
    for (let i = 0; i < LINKEDIN_STRATEGY_PROFILE_LIMIT; i++) {
      const result = await handleLinkedInStrategyRequest(deps, { profileId: 'p1', ip: '203.0.113.1', niche: 'Gaming', targetGoal: 'Partnerships' });
      expect(result.status).toBe(200);
    }
    const blocked = await handleLinkedInStrategyRequest(deps, { profileId: 'p1', ip: '203.0.113.1', niche: 'Gaming', targetGoal: 'Partnerships' });
    expect(blocked.status).toBe(429);
  });

  it('releases the rate-limit slot when generation throws', async () => {
    let failing = true;
    const deps = makeDeps({
      linkedInStrategyClient: {
        generateStrategy: async () => {
          if (failing) throw new Error('Claude API request failed with status 500');
          return createFakeLinkedInStrategyClient().generateStrategy({ niche: 'Gaming', targetGoal: 'Partnerships' });
        },
      },
    });
    await expect(
      handleLinkedInStrategyRequest(deps, { profileId: 'p1', ip: '203.0.113.1', niche: 'Gaming', targetGoal: 'Partnerships' })
    ).rejects.toThrow('Claude API request failed');

    // The failed attempt didn't consume the daily limit — a fresh attempt still succeeds.
    failing = false;
    const retry = await handleLinkedInStrategyRequest(deps, {
      profileId: 'p1',
      ip: '203.0.113.1',
      niche: 'Gaming',
      targetGoal: 'Partnerships',
    });
    expect(retry.status).toBe(200);
  });
});
