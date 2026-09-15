import { checkAndRecordRateLimit, releaseRateLimitEventIfNeeded, hashIp, type RateLimitStore } from '@/lib/rate-limit';
import type { ContentIdeasClient, ContentIdea } from '@/lib/integrations/claude-ideas';

export const IDEAS_GENERATION_PROFILE_LIMIT = 5;
export const IDEAS_GENERATION_IP_LIMIT = 10;

export interface WeeklyDigestRow {
  id: string;
  profileId: string;
  weekStart: string;
  contentIdeas: ContentIdea[];
}

export interface IdeasHandlerDeps {
  rateLimitStore: RateLimitStore;
  contentIdeasClient: ContentIdeasClient;
  ipSalt: string;
  hasActiveSubscription: (profileId: string) => Promise<boolean>;
  getProfileNiche: (profileId: string) => Promise<string | null>;
  getExistingDigest: (profileId: string, weekStart: string) => Promise<WeeklyDigestRow | null>;
  saveDigest: (params: { profileId: string; weekStart: string; contentIdeas: ContentIdea[] }) => Promise<WeeklyDigestRow>;
}

export interface IdeasRequestContext {
  profileId: string | null;
  ip: string;
  now: Date;
  context?: string;
}

export interface IdeasHandlerResult {
  status: number;
  body: Record<string, unknown>;
}

/** Monday of the week containing `date`, as a UTC date string (YYYY-MM-DD). */
export function weekStartKey(date: Date): string {
  const day = date.getUTCDay(); // 0 = Sunday, 1 = Monday, ...
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + diffToMonday));
  return monday.toISOString().slice(0, 10);
}

export async function handleIdeasRequest(deps: IdeasHandlerDeps, context: IdeasRequestContext): Promise<IdeasHandlerResult> {
  if (!context.profileId) {
    return { status: 401, body: { error: 'You must be signed in to generate content ideas.' } };
  }

  if (!(await deps.hasActiveSubscription(context.profileId))) {
    return {
      status: 402,
      body: { error: 'Weekly Content Ideas requires an active subscription.', upgradeUrl: '/billing' },
    };
  }

  const niche = await deps.getProfileNiche(context.profileId);
  if (!niche) {
    return { status: 400, body: { error: 'Set your niche before generating ideas.' } };
  }

  const weekStart = weekStartKey(context.now);

  const existing = await deps.getExistingDigest(context.profileId, weekStart);
  if (existing) {
    return { status: 200, body: { digest: existing, cached: true } };
  }

  const ipHash = hashIp(context.ip, deps.ipSalt);
  const rateLimitResult = await checkAndRecordRateLimit({
    store: deps.rateLimitStore,
    profileId: context.profileId,
    ipHash,
    eventType: 'content_ideas_generation',
    profileLimit: IDEAS_GENERATION_PROFILE_LIMIT,
    ipLimit: IDEAS_GENERATION_IP_LIMIT,
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
            : "You've hit today's limit for idea generation attempts. Please try again tomorrow.",
        retryAfter: rateLimitResult.retryAfter?.toISOString(),
      },
    };
  }

  try {
    const ideas = await deps.contentIdeasClient.generateContentIdeas(niche, context.now, context.context);

    if (ideas.length === 0) {
      // A real, costly generation ran and genuinely found nothing honest
      // for this niche this week — not our own failure, so the
      // rate-limit event is NOT released; it's a legitimate use of one
      // of today's attempts. No row is written, so a later attempt this
      // week isn't blocked by the (profile, week_start) unique
      // constraint. Mirrors spec §4 / Recap Card's identical rule.
      return {
        status: 422,
        body: { error: "Couldn't find a real, current angle for your niche this week. Try again in a day or two." },
      };
    }

    const saved = await deps.saveDigest({ profileId: context.profileId, weekStart, contentIdeas: ideas });
    return { status: 200, body: { digest: saved } };
  } catch (err) {
    await releaseRateLimitEventIfNeeded({ store: deps.rateLimitStore, eventId: rateLimitResult.eventId });
    throw err;
  }
}
