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
    discoverTikTokBigAccounts: async () => emptyResult(),
    discoverInstagramBigAccounts: async () => emptyResult(),
    insertAlert: async ({ post: p, severity }) => {
      inserted.push({ post: p, severity });
      return { inserted: true };
    },
    pauseForBudget: async () => {},
    getOptedInEmails: async () => [],
    emailClient: client,
    operatorEmail: 'operator@example.com',
    sleep: async () => {}, // the fan-out's rate-limit throttle, instant in tests
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

  it('includes posts discovered via the big-account TikTok and Instagram scrapers', async () => {
    const { deps, inserted } = makeDeps({
      discoverTikTokBigAccounts: async () => ({ posts: [post({ platform: 'tiktok', externalPostId: 'bt1', viewCount: 1_000_000 })], errors: [] }),
      discoverInstagramBigAccounts: async () => ({
        posts: [post({ platform: 'instagram', externalPostId: 'bi1', engagementCount: 20_000 })],
        errors: [],
      }),
    });
    const result = await runWarroomCron(deps, NOW);
    expect(result.inserted).toBe(2);
    const insertedIds = inserted.map((c) => c.post.externalPostId).sort();
    expect(insertedIds).toEqual(['bi1', 'bt1']);
  });

  it('continues processing when a big-account discovery source rejects', async () => {
    const { deps, inserted } = makeDeps({
      discoverYoutube: async () => ({ posts: [post()], errors: [] }),
      discoverTikTokBigAccounts: async () => {
        throw new Error('tiktok big-account scrape is down');
      },
    });
    const result = await runWarroomCron(deps, NOW);
    expect(result.inserted).toBe(1);
    expect(inserted).toHaveLength(1);
  });

  it('caps a single run to WARROOM_PER_RUN_CAP alerts', async () => {
    const manyPosts = Array.from({ length: WARROOM_PER_RUN_CAP + 3 }, (_, i) =>
      post({ externalPostId: `p${i}`, viewCount: 300_000 })
    );
    const { deps, inserted } = makeDeps({ discoverYoutube: async () => ({ posts: manyPosts, errors: [] }) });
    const result = await runWarroomCron(deps, NOW);
    expect(result.inserted).toBe(WARROOM_PER_RUN_CAP);
    expect(inserted).toHaveLength(WARROOM_PER_RUN_CAP);
  });

  it('keeps only the highest-severity alerts when discovery finds more than the per-run cap', async () => {
    // 2 already_viral + 3 going_viral = exactly WARROOM_PER_RUN_CAP (5); 3 heating_up
    // posts are also found but must all be dropped -- this is the only test that
    // would fail if the cap's severity sort were ever inverted or removed, since
    // the count-only cap test above passes regardless of sort order.
    const alreadyViral = [
      post({ externalPostId: 'av0', viewCount: 1_000_000, publishedAt: '2026-09-15T10:00:00Z' }), // 2h old
      post({ externalPostId: 'av1', viewCount: 1_000_000, publishedAt: '2026-09-15T10:00:00Z' }),
    ];
    const goingViral = [
      post({ externalPostId: 'gv0', viewCount: 4_400, publishedAt: '2026-09-15T10:00:00Z' }), // 2h old, 2200 views/hr
      post({ externalPostId: 'gv1', viewCount: 4_400, publishedAt: '2026-09-15T10:00:00Z' }),
      post({ externalPostId: 'gv2', viewCount: 4_400, publishedAt: '2026-09-15T10:00:00Z' }),
    ];
    const heatingUp = [
      post({ externalPostId: 'hu0', viewCount: 6_000, publishedAt: '2026-09-15T02:00:00Z' }), // 10h old, 600 views/hr
      post({ externalPostId: 'hu1', viewCount: 6_000, publishedAt: '2026-09-15T02:00:00Z' }),
      post({ externalPostId: 'hu2', viewCount: 6_000, publishedAt: '2026-09-15T02:00:00Z' }),
    ];
    const { deps, inserted } = makeDeps({
      discoverYoutube: async () => ({ posts: [...alreadyViral, ...goingViral, ...heatingUp], errors: [] }),
    });
    const result = await runWarroomCron(deps, NOW);
    expect(result.inserted).toBe(WARROOM_PER_RUN_CAP);
    const insertedIds = inserted.map((c) => c.post.externalPostId).sort();
    expect(insertedIds).toEqual(['av0', 'av1', 'gv0', 'gv1', 'gv2']);
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

  it('emails opted-in subscribers for a going_viral-only alert, not just already_viral', async () => {
    // The other email test above only ever uses an already_viral post, so it
    // can't catch a future edit that narrowed the fan-out filter to
    // already_viral alone -- this specifically proves going_viral qualifies too.
    const { client, sent } = createFakeEmailClient();
    const goingViralPost = post({ viewCount: 4_400, publishedAt: '2026-09-15T10:00:00Z' }); // youtube going_viral
    const { deps } = makeDeps({
      discoverYoutube: async () => ({ posts: [goingViralPost], errors: [] }),
      getOptedInEmails: async () => ['a@example.com'],
      emailClient: client,
    });
    await runWarroomCron(deps, NOW);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('a@example.com');
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

  it('does not abort the email fan-out when one send fails', async () => {
    const sent: string[] = [];
    const { deps } = makeDeps({
      discoverYoutube: async () => ({ posts: [post({ externalPostId: 'v1', viewCount: 300_000 })], errors: [] }),
      getOptedInEmails: async () => ['fail@example.com', 'ok@example.com'],
      emailClient: {
        sendEmail: async (params) => {
          if (params.to === 'fail@example.com') throw new Error('429 rate limited');
          sent.push(params.to);
        },
      },
    });
    const result = await runWarroomCron(deps, NOW);
    expect(result.skipped).toBeNull();
    expect(sent).toEqual(['ok@example.com']);
  });

  it('throttles between sends so the fan-out stays under Resend\'s rate limit', async () => {
    const delays: number[] = [];
    const { client } = createFakeEmailClient();
    const { deps } = makeDeps({
      discoverYoutube: async () => ({ posts: [post()], errors: [] }),
      getOptedInEmails: async () => ['a@example.com', 'b@example.com'],
      emailClient: client,
      sleep: async (ms) => {
        delays.push(ms);
      },
    });
    await runWarroomCron(deps, NOW);
    expect(delays).toHaveLength(2);
    expect(delays.every((ms) => ms >= 500)).toBe(true);
  });

  it('HTML-escapes scraped post content before interpolating it into email HTML', async () => {
    const { client, sent } = createFakeEmailClient();
    const { deps } = makeDeps({
      discoverYoutube: async () => ({
        posts: [
          post({
            externalPostId: 'v1',
            viewCount: 300_000,
            captionOrTitle: '<script>alert(1)</script>',
            url: 'https://example.com/"onmouseover="x',
          }),
        ],
        errors: [],
      }),
      getOptedInEmails: async () => ['a@example.com'],
      emailClient: client,
    });
    await runWarroomCron(deps, NOW);
    expect(sent).toHaveLength(1);
    expect(sent[0].html).not.toContain('<script>');
    expect(sent[0].html).toContain('&lt;script&gt;');
    expect(sent[0].html).not.toContain('"onmouseover="x');
  });

  it('escapes the budget error before interpolating it into the operator email', async () => {
    const { client, sent } = createFakeEmailClient();
    const { deps } = makeDeps({
      discoverTikTok: async () => ({ posts: [], errors: ['<img src=x onerror=y> monthly usage hard limit exceeded'] }),
      emailClient: client,
    });
    await runWarroomCron(deps, NOW);
    expect(sent).toHaveLength(1);
    expect(sent[0].html).not.toContain('<img src=x');
    expect(sent[0].html).toContain('&lt;img src=x');
  });

  it('clamps the per-run insert count to the remaining daily headroom, not just the flat per-run cap', async () => {
    const { deps, inserted } = makeDeps({
      countAlertsToday: async () => WARROOM_DAILY_ALERT_CAP - 2, // only 2 slots left today
      discoverYoutube: async () => ({
        posts: [
          post({ externalPostId: 'v1', viewCount: 300_000 }),
          post({ externalPostId: 'v2', viewCount: 300_000 }),
          post({ externalPostId: 'v3', viewCount: 300_000 }),
          post({ externalPostId: 'v4', viewCount: 300_000 }),
          post({ externalPostId: 'v5', viewCount: 300_000 }),
        ],
        errors: [],
      }),
    });
    const result = await runWarroomCron(deps, NOW);
    expect(result.inserted).toBe(2);
    expect(inserted).toHaveLength(2);
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
