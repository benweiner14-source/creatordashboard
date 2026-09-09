import { checkAndRecordRateLimit, releaseRateLimitEventIfNeeded, hashIp, type RateLimitStore } from '@/lib/rate-limit';
import type { LinkedInStrategyClient, GeneratedLinkedInStrategy } from '@/lib/integrations/claude-linkedin-strategy';

export const LINKEDIN_STRATEGY_PROFILE_LIMIT = 5;
export const LINKEDIN_STRATEGY_IP_LIMIT = 10;

// The "Something else" option makes niche and goal free text, so without a cap
// an arbitrarily long value goes straight into a Claude prompt and an unbounded
// `text` column. Matches `lib/ideas/niche.ts`'s MAX_NICHE_LENGTH.
export const LINKEDIN_INPUT_MAX_LENGTH = 200;

export interface SavedLinkedInStrategy extends GeneratedLinkedInStrategy {
  id: string;
  niche: string;
  targetGoal: string;
  createdAt: string;
}

export interface LinkedInStrategyHandlerDeps {
  rateLimitStore: RateLimitStore;
  linkedInStrategyClient: LinkedInStrategyClient;
  ipSalt: string;
  hasActiveSubscription: (profileId: string) => Promise<boolean>;
  saveStrategy: (params: {
    profileId: string;
    niche: string;
    targetGoal: string;
    strategy: GeneratedLinkedInStrategy;
  }) => Promise<SavedLinkedInStrategy>;
}

export interface LinkedInStrategyRequestContext {
  profileId: string | null;
  ip: string;
  niche: string;
  targetGoal: string;
}

export interface LinkedInStrategyHandlerResult {
  status: number;
  body: Record<string, unknown>;
}

export async function handleLinkedInStrategyRequest(
  deps: LinkedInStrategyHandlerDeps,
  context: LinkedInStrategyRequestContext
): Promise<LinkedInStrategyHandlerResult> {
  if (!context.profileId) {
    return { status: 401, body: { error: 'You must be signed in to build a LinkedIn strategy.' } };
  }

  if (!(await deps.hasActiveSubscription(context.profileId))) {
    return { status: 402, body: { error: 'LinkedIn Content Strategy requires an active subscription.', upgradeUrl: '/billing' } };
  }

  const niche = context.niche.trim();
  const targetGoal = context.targetGoal.trim();
  if (!niche || !targetGoal) {
    return { status: 400, body: { error: 'Choose a niche and a goal before building your strategy.' } };
  }

  if (niche.length > LINKEDIN_INPUT_MAX_LENGTH || targetGoal.length > LINKEDIN_INPUT_MAX_LENGTH) {
    return {
      status: 400,
      body: { error: `Keep your niche and goal under ${LINKEDIN_INPUT_MAX_LENGTH} characters.` },
    };
  }

  const ipHash = hashIp(context.ip, deps.ipSalt);
  const rateLimitResult = await checkAndRecordRateLimit({
    store: deps.rateLimitStore,
    profileId: context.profileId,
    ipHash,
    eventType: 'linkedin_strategy_generation',
    profileLimit: LINKEDIN_STRATEGY_PROFILE_LIMIT,
    ipLimit: LINKEDIN_STRATEGY_IP_LIMIT,
    windowDays: 1,
  });

  if (!rateLimitResult.allowed) {
    return {
      status: 429,
      body: {
        error:
          rateLimitResult.reason === 'ip_limit'
            ? 'Too many strategy generations have been requested from this network recently. Please try again later.'
            : "You've hit today's limit for building a strategy. Please try again tomorrow.",
      },
    };
  }

  try {
    const generated = await deps.linkedInStrategyClient.generateStrategy({ niche, targetGoal });
    const saved = await deps.saveStrategy({ profileId: context.profileId, niche, targetGoal, strategy: generated });
    return { status: 200, body: { strategy: saved } };
  } catch (err) {
    await releaseRateLimitEventIfNeeded({ store: deps.rateLimitStore, eventId: rateLimitResult.eventId });
    throw err;
  }
}
