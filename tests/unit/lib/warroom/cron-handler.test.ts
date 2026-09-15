import { describe, it, expect, vi } from 'vitest';
import { runWarroomCron, WARROOM_DAILY_ALERT_CAP, WARROOM_PER_RUN_CAP, type WarroomCronDeps } from '@/lib/warroom/cron-handler';
import { createFakeEmailClient } from '../../../fakes/resend.fake';
import type { DiscoveredPost, DiscoveryResult, WarroomSeverity } from '@/lib/warroom/types';

const NOW = new Date('2026-09-15T12:00:00Z');

function post(overrides: Partial<DiscoveredPost> = {}): DiscoveredPost {
  return {
    platform: 'youtube',
    externalPostId: 'p1',
    url: 'https://example.com/p1',
    captionOrTitle: 'GTA 6 news',
    viewCount: 300_000, // already_viral on YouTube regardless of age
    engagementCount: 1000,
    publishedAt: '2026-09-15T11:00:00Z',
    ...overrides,
  };
}

function emptyResult(): DiscoveryResult {
  return { posts: [], errors: [] };
}

function makeDeps(overrides: Partial<WarroomCronDeps> = {}): { deps: WarroomCronDeps; inserted: Array<{ post: DiscoveredPost; severity: WarroomSeverity }> } {
  const inserted: Array<{ post: DiscoveredPost; severity: WarroomSeverity }> = [];
  const { client } = createFakeEmailClient();
  const deps: WarroomCronDeps = {
    isPaused: async () => false,
    countAlertsToday: async () => 0,
    discoverYoutube: async () => emptyResult(),
    discoverTikTok: async () => emptyResult(),
    discoverInstagram: async () => emptyResult(),
    insertAlert: async ({ post: p, severity }) => {
      inserted.push({ post: p, severity });
      return { inserted: true };
    },
    pauseForBudget: async () => {},
    getOptedInEmails: async () => [],
    emailClient: client,
    operatorEmail: 'operator@example.com',
    ...overrides,
  };
  return { deps, inserted };
}

describe('runWarroomCron', () => {
  it('does nothing when already paused', async () => {
    const { deps } = makeDeps({ isPaused: async () => true, discoverYoutube: () => { throw new Error('should not be called'); } });
    const result = await runWarroomCron(deps, NOW);
    expect(result).toEqual({ skipped: 'paused', inserted: 0 });
  });

  it('does nothing once the daily cap is reached', async () => {
    const { deps } = makeDeps({
      countAlertsToday: async () => WARROOM_DAILY_ALERT_CAP,
      discoverYoutube: () => { throw new Error('should not be called'); },
    });
    const result = await runWarroomCron(deps, NOW);
    expect(result).toEqual({ skipped: 'daily_cap', inserted: 0 });
  });

  it('inserts a post that crosses a threshold', async () => {
    const { deps, inserted } = makeDeps({ discoverYoutube: async () => ({ posts: [post()], errors: [] }) });
    const result = await runWarroomCron(deps, NOW);
    expect(result.inserted).toBe(1);
    expect(inserted[0].severity).toBe('already_viral');
  });

  it('drops a post that scores no severity', async () => {
    const { deps, inserted } = makeDeps({
      discoverYoutube: async () => ({ posts: [post({ viewCount: 10, engagementCount: 1 })], errors: [] }),
    });
    await runWarroomCron(deps, NOW);
    expect(inserted).toHaveLength(0);
  });

  it('continues processing when one platform rejects', async () => {
    const { deps, inserted } = makeDeps({
      discoverYoutube: async () => ({ posts: [post()], errors: [] }),
      discoverTikTok: async () => { throw new Error('tiktok is down'); },
    });
    const result = await runWarroomCron(deps, NOW);
    expect(result.inserted).toBe(1);
    expect(inserted).toHaveLength(1);
  });

  it('caps a single run to WARROOM_PER_RUN_CAP alerts, highest severity first', async () => {
    const manyPosts = Array.from({ length: WARROOM_PER_RUN_CAP + 3 }, (_, i) =>
      post({ externalPostId: `p${i}`, viewCount: 300_000 })
    );
    const { deps, inserted } = makeDeps({ discoverYoutube: async () => ({ posts: manyPosts, errors: [] }) });
    const result = await runWarroomCron(deps, NOW);
    expect(result.inserted).toBe(WARROOM_PER_RUN_CAP);
    expect(inserted).toHaveLength(WARROOM_PER_RUN_CAP);
  });

  it('deduplicates identical (platform, externalPostId) pairs within a single run', async () => {
    const duplicate = post();
    const { deps, inserted } = makeDeps({ discoverYoutube: async () => ({ posts: [duplicate, { ...duplicate }], errors: [] }) });
    await runWarroomCron(deps, NOW);
    expect(inserted).toHaveLength(1);
  });

  it('pauses and sends exactly one operator email when a budget-exceeded error is detected, without inserting anything', async () => {
    const { client, sent } = createFakeEmailClient();
    const pauseForBudget = vi.fn();
    const { deps, inserted } = makeDeps({
      discoverYoutube: async () => ({ posts: [post()], errors: [] }),
      discoverTikTok: async () => ({ posts: [], errors: ['Apify hard limit exceeded for this month'] }),
      pauseForBudget,
      emailClient: client,
    });

    const result = await runWarroomCron(deps, NOW);

    expect(result.skipped).toBe('budget_exceeded');
    expect(pauseForBudget).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('operator@example.com');
    expect(inserted).toHaveLength(0);
  });

  it('does not pause on a non-budget error, and still inserts alerts found elsewhere', async () => {
    const { deps, inserted } = makeDeps({
      discoverYoutube: async () => ({ posts: [post()], errors: [] }),
      discoverTikTok: async () => ({ posts: [], errors: ['some transient scraper error'] }),
      pauseForBudget: () => { throw new Error('should not be called'); },
    });
    const result = await runWarroomCron(deps, NOW);
    expect(result.skipped).toBeNull();
    expect(inserted).toHaveLength(1);
  });

  it('emails every opted-in subscriber for a going_viral or already_viral alert', async () => {
    const { client, sent } = createFakeEmailClient();
    const { deps } = makeDeps({
      discoverYoutube: async () => ({ posts: [post()], errors: [] }), // already_viral
      getOptedInEmails: async () => ['a@example.com', 'b@example.com'],
      emailClient: client,
    });
    await runWarroomCron(deps, NOW);
    expect(sent).toHaveLength(2);
    expect(sent.map((e) => e.to).sort()).toEqual(['a@example.com', 'b@example.com']);
  });

  it('does not email opted-in subscribers for a heating_up-only alert', async () => {
    const { client, sent } = createFakeEmailClient();
    const heatingUpPost = post({ viewCount: 6_000, publishedAt: '2026-09-15T02:00:00Z' }); // youtube heating_up
    const { deps } = makeDeps({
      discoverYoutube: async () => ({ posts: [heatingUpPost], errors: [] }),
      getOptedInEmails: async () => ['a@example.com'],
      emailClient: client,
    });
    await runWarroomCron(deps, NOW);
    expect(sent).toHaveLength(0);
  });

  it('does not re-email for an alert insertAlert reports as an existing duplicate', async () => {
    const { client, sent } = createFakeEmailClient();
    const { deps } = makeDeps({
      discoverYoutube: async () => ({ posts: [post()], errors: [] }),
      insertAlert: async () => ({ inserted: false }), // already existed
      getOptedInEmails: async () => ['a@example.com'],
      emailClient: client,
    });
    await runWarroomCron(deps, NOW);
    expect(sent).toHaveLength(0);
  });
});
