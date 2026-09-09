import { describe, it, expect } from 'vitest';
import {
  handleLinkedInStrategyRequest,
  LINKEDIN_INPUT_MAX_LENGTH,
  LINKEDIN_STRATEGY_PROFILE_LIMIT,
} from '@/lib/linkedin/strategy-handler';
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

  it('rejects an over-long niche or goal without spending a rate-limit slot', async () => {
    // The "Something else" option makes both fields free text, so an oversized
    // value would otherwise reach a Claude prompt and an unbounded text column.
    let recordCalls = 0;
    const inner = createInMemoryRateLimitStore();
    const rateLimitStore = {
      ...inner,
      checkAndRecordAtomically: async (params: Parameters<typeof inner.checkAndRecordAtomically>[0]) => {
        recordCalls++;
        return inner.checkAndRecordAtomically(params);
      },
    };
    const tooLong = 'a'.repeat(LINKEDIN_INPUT_MAX_LENGTH + 1);

    const longNiche = await handleLinkedInStrategyRequest(makeDeps({ rateLimitStore }), {
      profileId: 'p1',
      ip: '203.0.113.1',
      niche: tooLong,
      targetGoal: 'Partnerships',
    });
    expect(longNiche.status).toBe(400);
    expect(longNiche.body.error).toContain(String(LINKEDIN_INPUT_MAX_LENGTH));

    const longGoal = await handleLinkedInStrategyRequest(makeDeps({ rateLimitStore }), {
      profileId: 'p1',
      ip: '203.0.113.1',
      niche: 'Gaming',
      targetGoal: tooLong,
    });
    expect(longGoal.status).toBe(400);

    // The check has to sit before checkAndRecordRateLimit — a rejected request
    // must not burn one of the creator's five daily attempts.
    expect(recordCalls).toBe(0);
  });

  it(`accepts a niche and goal exactly at the ${LINKEDIN_INPUT_MAX_LENGTH}-character limit`, async () => {
    const atLimit = 'a'.repeat(LINKEDIN_INPUT_MAX_LENGTH);
    const result = await handleLinkedInStrategyRequest(makeDeps(), {
      profileId: 'p1',
      ip: '203.0.113.1',
      niche: atLimit,
      targetGoal: atLimit,
    });
    expect(result.status).toBe(200);
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

    // Exhaust the profile limit with failing attempts. Each one only stays
    // exhausted if the release call is broken — proving the release happens
    // requires driving the count all the way up and showing it didn't stick.
    for (let i = 0; i < LINKEDIN_STRATEGY_PROFILE_LIMIT; i++) {
      await expect(
        handleLinkedInStrategyRequest(deps, { profileId: 'p1', ip: '203.0.113.1', niche: 'Gaming', targetGoal: 'Partnerships' })
      ).rejects.toThrow('Claude API request failed');
    }

    // If releaseRateLimitEventIfNeeded were never called, the profile count
    // would now sit at LINKEDIN_STRATEGY_PROFILE_LIMIT and this call would be
    // rejected with 429 instead of succeeding.
    failing = false;
    const result = await handleLinkedInStrategyRequest(deps, {
      profileId: 'p1',
      ip: '203.0.113.1',
      niche: 'Gaming',
      targetGoal: 'Partnerships',
    });
    expect(result.status).toBe(200);
  });
});
