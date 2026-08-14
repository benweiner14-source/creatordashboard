import { describe, it, expect } from 'vitest';
import { handleIdeasRequest, IDEAS_GENERATION_PROFILE_LIMIT } from '@/lib/ideas/handler';
import { createInMemoryRateLimitStore } from '../../../fakes/rate-limit-store.fake';
import { createFakeContentIdeasClient } from '../../../fakes/claude-ideas.fake';
import type { WeeklyDigestRow } from '@/lib/ideas/handler';
import type { ContentIdea } from '@/lib/integrations/claude-ideas';

const IDEA: ContentIdea = {
  workingTitle: 'Sourdough Speedrun',
  pitch: 'Bake a loaf in under 2 hours on camera',
  medium: 'reel',
  format: 'Speed Recap',
  whyItsHotNow: 'Sourdough resurgence trending this week',
  sourceUrl: 'https://example.com/a',
  whyItRanksHere: 'High reach from trend-jacking',
  kpiSignals: ['reach'],
  reelDetails: { suggestedLengthSeconds: 60, style: 'talking-head' },
  carouselDetails: null,
};

function makeDeps(overrides: Partial<Parameters<typeof handleIdeasRequest>[0]> = {}) {
  const savedDigests: WeeklyDigestRow[] = [];
  return {
    rateLimitStore: createInMemoryRateLimitStore(),
    contentIdeasClient: createFakeContentIdeasClient([IDEA]),
    ipSalt: 'test-salt',
    getProfileNiche: async () => 'home baking',
    getExistingDigest: async () => null,
    saveDigest: async (params: { profileId: string; weekStart: string; contentIdeas: ContentIdea[] }) => {
      const row: WeeklyDigestRow = { id: `digest-${savedDigests.length + 1}`, profileId: params.profileId, weekStart: params.weekStart, contentIdeas: params.contentIdeas };
      savedDigests.push(row);
      return row;
    },
    ...overrides,
  };
}

// A Thursday — picking a mid-week date makes the Monday-of-week math in
// the handler's weekStartKey() actually exercise the "go backward" branch.
const NOW = new Date('2026-08-13T12:00:00Z');

describe('handleIdeasRequest', () => {
  it('rejects requests without a signed-in profile', async () => {
    const result = await handleIdeasRequest(makeDeps(), { profileId: null, ip: '203.0.113.1', now: NOW });
    expect(result.status).toBe(401);
  });

  it('rejects when no niche is set', async () => {
    const deps = makeDeps({ getProfileNiche: async () => null });
    const result = await handleIdeasRequest(deps, { profileId: 'p1', ip: '203.0.113.1', now: NOW });
    expect(result.status).toBe(400);
  });

  it('returns the existing digest for this week without generating again', async () => {
    const contentIdeasClient = createFakeContentIdeasClient([IDEA]);
    const existing: WeeklyDigestRow = { id: 'digest-existing', profileId: 'p1', weekStart: '2026-08-10', contentIdeas: [IDEA] };
    const deps = makeDeps({ contentIdeasClient, getExistingDigest: async () => existing });

    const result = await handleIdeasRequest(deps, { profileId: 'p1', ip: '203.0.113.1', now: NOW });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ digest: existing, cached: true });
  });

  it('generates and saves a new digest, keying the week to the Monday of the current week', async () => {
    const deps = makeDeps();
    const result = await handleIdeasRequest(deps, { profileId: 'p1', ip: '203.0.113.1', now: NOW });
    expect(result.status).toBe(200);
    const body = result.body as { digest: WeeklyDigestRow };
    expect(body.digest.weekStart).toBe('2026-08-10'); // Monday of the week containing 2026-08-13 (Thursday)
    expect(body.digest.contentIdeas).toEqual([IDEA]);
  });

  it('returns a distinct 422 without saving when generation finds zero ideas', async () => {
    const deps = makeDeps({ contentIdeasClient: createFakeContentIdeasClient([]) });
    const result = await handleIdeasRequest(deps, { profileId: 'p1', ip: '203.0.113.1', now: NOW });
    expect(result.status).toBe(422);
  });

  it('rate-limits repeated generation attempts per profile per day', async () => {
    const deps = makeDeps({ contentIdeasClient: createFakeContentIdeasClient([]) });
    let result;
    for (let i = 0; i < IDEAS_GENERATION_PROFILE_LIMIT; i++) {
      result = await handleIdeasRequest(deps, { profileId: 'p1', ip: '203.0.113.1', now: NOW });
      expect(result.status).toBe(422); // zero ideas each time, but still consumes an attempt
    }
    result = await handleIdeasRequest(deps, { profileId: 'p1', ip: '203.0.113.1', now: NOW });
    expect(result.status).toBe(429);
  });
});
