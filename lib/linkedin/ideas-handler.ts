import { checkAndRecordRateLimit, releaseRateLimitEventIfNeeded, hashIp, type RateLimitStore } from '@/lib/rate-limit';
import { weekStartKey } from '@/lib/ideas/handler';
import type { LinkedInIdeasClient, LinkedInPostIdea } from '@/lib/integrations/claude-linkedin-ideas';

export const LINKEDIN_IDEAS_PROFILE_LIMIT = 5;
export const LINKEDIN_IDEAS_IP_LIMIT = 10;

export interface LinkedInIdeasRow {
  id: string;
  strategyId: string;
  weekStart: string;
  postIdeas: LinkedInPostIdea[];
}

export interface LatestLinkedInStrategySummary {
  id: string;
  niche: string;
  targetGoal: string;
}

export interface LinkedInIdeasHandlerDeps {
  rateLimitStore: RateLimitStore;
  linkedInIdeasClient: LinkedInIdeasClient;
  ipSalt: string;
  hasActiveSubscription: (profileId: string) => Promise<boolean>;
  getLatestStrategy: (profileId: string) => Promise<LatestLinkedInStrategySummary | null>;
  getExistingIdeas: (profileId: string, weekStart: string) => Promise<LinkedInIdeasRow | null>;
  saveIdeas: (params: {
    profileId: string;
    strategyId: string;
    weekStart: string;
    postIdeas: LinkedInPostIdea[];
  }) => Promise<LinkedInIdeasRow>;
}

export interface LinkedInIdeasRequestContext {
  profileId: string | null;
  ip: string;
  now: Date;
}

export interface LinkedInIdeasHandlerResult {
  status: number;
  body: Record<string, unknown>;
}

export async function handleLinkedInIdeasRequest(
  deps: LinkedInIdeasHandlerDeps,
  context: LinkedInIdeasRequestContext
): Promise<LinkedInIdeasHandlerResult> {
  if (!context.profileId) {
    return { status: 401, body: { error: 'You must be signed in to view your LinkedIn post ideas.' } };
  }

  if (!(await deps.hasActiveSubscription(context.profileId))) {
    return { status: 402, body: { error: 'LinkedIn Content Strategy requires an active subscription.', upgradeUrl: '/billing' } };
  }

  const strategy = await deps.getLatestStrategy(context.profileId);
  if (!strategy) {
    return { status: 400, body: { error: 'Build a LinkedIn strategy first — post ideas are based on your niche and goal.' } };
  }

  const weekStart = weekStartKey(context.now);
  const existing = await deps.getExistingIdeas(context.profileId, weekStart);
  if (existing) {
    return { status: 200, body: { ideas: existing, cached: true } };
  }

  const ipHash = hashIp(context.ip, deps.ipSalt);
  const rateLimitResult = await checkAndRecordRateLimit({
    store: deps.rateLimitStore,
    profileId: context.profileId,
    ipHash,
    eventType: 'linkedin_ideas_generation',
    profileLimit: LINKEDIN_IDEAS_PROFILE_LIMIT,
    ipLimit: LINKEDIN_IDEAS_IP_LIMIT,
    windowDays: 1,
    now: context.now,
  });

  if (!rateLimitResult.allowed) {
    return {
      status: 429,
      body: {
        error:
          rateLimitResult.reason === 'ip_limit'
            ? 'Too many idea generations have been requested from this network recently. Please try again later.'
            : "You've hit today's limit for generating post ideas. Please try again tomorrow.",
      },
    };
  }

  try {
    const postIdeas = await deps.linkedInIdeasClient.generateWeeklyIdeas(strategy.niche, strategy.targetGoal, context.now);

    if (postIdeas.length === 0) {
      // A real, costly generation ran and genuinely found nothing honest for
      // this niche/goal this week — not our own failure, so the rate-limit
      // event is NOT released; mirrors lib/ideas/handler.ts's identical rule.
      return {
        status: 422,
        body: { error: "Couldn't find honest, specific post ideas for your niche and goal this week. Try again in a day or two." },
      };
    }

    const saved = await deps.saveIdeas({ profileId: context.profileId, strategyId: strategy.id, weekStart, postIdeas });
    return { status: 200, body: { ideas: saved } };
  } catch (err) {
    await releaseRateLimitEventIfNeeded({ store: deps.rateLimitStore, eventId: rateLimitResult.eventId });
    throw err;
  }
}
