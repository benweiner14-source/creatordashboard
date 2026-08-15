import { describe, it, expect, vi } from 'vitest';
import { runWeeklyDigestCron, WEEKLY_DIGEST_RUN_CAP, buildUnsubscribeUrl } from '@/lib/digest/cron-handler';
import type { DigestCandidate, DigestRow, CronHandlerDeps } from '@/lib/digest/cron-handler';
import { createFakeContentIdeasClient } from '../../../fakes/claude-ideas.fake';
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

const CANDIDATE: DigestCandidate = { profileId: 'p1', email: 'creator@example.com', niche: 'home baking' };

// A Thursday — matches lib/ideas/handler.test.ts's convention of picking a
// mid-week date so weekStartKey's "go backward to Monday" branch is exercised.
const NOW = new Date('2026-08-13T12:00:00Z');
const WEEK_START = '2026-08-10';

function makeDeps(overrides: Partial<CronHandlerDeps> = {}): CronHandlerDeps {
  return {
    getOptedInCandidates: async () => [CANDIDATE],
    getExistingDigest: async () => null,
    saveDigest: async ({ profileId, weekStart, contentIdeas }) => ({
      id: 'digest-1',
      profileId,
      weekStart,
      contentIdeas,
      sentAt: null,
    }),
    markDigestSent: async () => {},
    markProfileDigestSent: async () => {},
    contentIdeasClient: createFakeContentIdeasClient([IDEA]),
    emailClient: { sendEmail: vi.fn().mockResolvedValue(undefined) },
    unsubscribeSecret: 'test-secret',
    appUrl: 'https://example.com',
    ...overrides,
  };
}

describe('runWeeklyDigestCron', () => {
  it('asks for candidates up to the run cap', async () => {
    const getOptedInCandidates = vi.fn().mockResolvedValue([]);
    await runWeeklyDigestCron(makeDeps({ getOptedInCandidates }), NOW);
    expect(getOptedInCandidates).toHaveBeenCalledWith(WEEKLY_DIGEST_RUN_CAP);
  });

  it('generates, saves, emails, and marks sent for a candidate with no existing digest', async () => {
    const sendEmail = vi.fn().mockResolvedValue(undefined);
    const markDigestSent = vi.fn().mockResolvedValue(undefined);
    const markProfileDigestSent = vi.fn().mockResolvedValue(undefined);
    const result = await runWeeklyDigestCron(
      makeDeps({ emailClient: { sendEmail }, markDigestSent, markProfileDigestSent }),
      NOW
    );

    expect(result).toEqual({ sent: ['p1'], skipped: [], failed: [] });
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'creator@example.com', subject: expect.stringContaining(WEEK_START) })
    );
    expect(markDigestSent).toHaveBeenCalledWith('digest-1', NOW);
    expect(markProfileDigestSent).toHaveBeenCalledWith('p1', NOW);
  });

  it('skips generation but still sends for a candidate with an existing, unsent digest', async () => {
    const contentIdeasClient = createFakeContentIdeasClient([IDEA]);
    const generateSpy = vi.spyOn(contentIdeasClient, 'generateContentIdeas');
    const sendEmail = vi.fn().mockResolvedValue(undefined);
    const existing: DigestRow = { id: 'digest-existing', profileId: 'p1', weekStart: WEEK_START, contentIdeas: [IDEA], sentAt: null };

    const result = await runWeeklyDigestCron(
      makeDeps({ contentIdeasClient, getExistingDigest: async () => existing, emailClient: { sendEmail } }),
      NOW
    );

    expect(generateSpy).not.toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ sent: ['p1'], skipped: [], failed: [] });
  });

  it('skips entirely — no email — for a candidate whose digest this week is already sent', async () => {
    const sendEmail = vi.fn().mockResolvedValue(undefined);
    const existing: DigestRow = {
      id: 'digest-existing',
      profileId: 'p1',
      weekStart: WEEK_START,
      contentIdeas: [IDEA],
      sentAt: '2026-08-10T13:00:00Z',
    };

    const result = await runWeeklyDigestCron(makeDeps({ getExistingDigest: async () => existing, emailClient: { sendEmail } }), NOW);

    expect(sendEmail).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: [], skipped: ['p1'], failed: [] });
  });

  it('skips without failing when generation finds zero ideas, and does not save or send', async () => {
    const saveDigest = vi.fn();
    const sendEmail = vi.fn().mockResolvedValue(undefined);
    const result = await runWeeklyDigestCron(
      makeDeps({ contentIdeasClient: createFakeContentIdeasClient([]), saveDigest, emailClient: { sendEmail } }),
      NOW
    );

    expect(saveDigest).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: [], skipped: ['p1'], failed: [] });
  });

  it('isolates one failing candidate from the rest of the run', async () => {
    const otherCandidate: DigestCandidate = { profileId: 'p2', email: 'other@example.com', niche: 'home baking' };
    const sendEmail = vi
      .fn()
      .mockRejectedValueOnce(new Error('Resend API request failed with status 500'))
      .mockResolvedValueOnce(undefined);

    const result = await runWeeklyDigestCron(
      makeDeps({ getOptedInCandidates: async () => [CANDIDATE, otherCandidate], emailClient: { sendEmail } }),
      NOW
    );

    expect(result.failed).toEqual(['p1']);
    expect(result.sent).toEqual(['p2']);
  });
});

describe('buildUnsubscribeUrl', () => {
  it('embeds the profile id and a verifiable token in the URL', () => {
    const url = buildUnsubscribeUrl('p1', 'test-secret', 'https://example.com');
    expect(url).toMatch(/^https:\/\/example\.com\/api\/digest\/unsubscribe\?profile=p1&token=[0-9a-f]+$/);
  });
});
