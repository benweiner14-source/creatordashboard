import { checkAndRecordRateLimit, releaseRateLimitEventIfNeeded, hashIp, type RateLimitStore } from '@/lib/rate-limit';
import type { YouTubeClient } from '@/lib/integrations/youtube';
import type { ScraperClient } from '@/lib/integrations/scraper';
import type { StrategyBreakdownClient } from '@/lib/integrations/claude-strategy';
import { detectHandlePlatform, normalizeHandle } from '@/lib/recap/handles';
import { computeCadence, computeFormatMix, computeAverageEngagementRate } from './aggregate';
import type { ChannelPost, CadenceSummary, FormatMixSummary } from './types';

export const STRATEGY_GENERATION_PROFILE_LIMIT = 5;
export const STRATEGY_GENERATION_IP_LIMIT = 10;

export interface StrategyHandlerDeps {
  rateLimitStore: RateLimitStore;
  youtubeClient: YouTubeClient;
  scraperClient: ScraperClient;
  claudeStrategyClient: StrategyBreakdownClient;
  ipSalt: string;
  hasActiveSubscription: (profileId: string) => Promise<boolean>;
  saveStrategyBreakdown: (params: {
    profileId: string;
    platform: 'youtube' | 'tiktok' | 'instagram';
    channelHandle: string;
    channelUrl: string;
    postCount: number;
    cadence: CadenceSummary;
    formatMix: FormatMixSummary;
    topPosts: Array<{ captionOrTitle: string; viewCount: number }>;
    headline: string;
    explanation: string;
  }) => Promise<{ id: string }>;
}

export interface StrategyRequestContext {
  profileId: string | null;
  ip: string;
  url: string;
}

export interface StrategyHandlerResult {
  status: number;
  body: Record<string, unknown>;
}

export async function handleStrategyBreakdownRequest(
  deps: StrategyHandlerDeps,
  context: StrategyRequestContext
): Promise<StrategyHandlerResult> {
  if (!context.profileId) {
    return { status: 401, body: { error: 'You must be signed in to run a strategy breakdown.' } };
  }

  if (!(await deps.hasActiveSubscription(context.profileId))) {
    return {
      status: 402,
      body: { error: 'Creator Strategy Breakdown requires an active subscription.', upgradeUrl: '/billing' },
    };
  }

  const platform = detectHandlePlatform(context.url);
  const handle = platform ? normalizeHandle(platform, context.url) : null;
  if (!platform || !handle) {
    return { status: 400, body: { error: 'That link is not a supported YouTube, TikTok, or Instagram channel URL.' } };
  }

  const ipHash = hashIp(context.ip, deps.ipSalt);
  const rateLimitResult = await checkAndRecordRateLimit({
    store: deps.rateLimitStore,
    profileId: context.profileId,
    ipHash,
    eventType: 'strategy_breakdown_generation',
    profileLimit: STRATEGY_GENERATION_PROFILE_LIMIT,
    ipLimit: STRATEGY_GENERATION_IP_LIMIT,
    windowDays: 1,
  });

  if (!rateLimitResult.allowed) {
    return {
      status: 429,
      body: {
        error:
          rateLimitResult.reason === 'ip_limit'
            ? 'Too many strategy breakdowns have been requested from this network recently. Please try again later.'
            : "You've hit today's limit for strategy breakdowns. Please try again tomorrow.",
        retryAfter: rateLimitResult.retryAfter?.toISOString(),
      },
    };
  }

  try {
    let channelPosts: ChannelPost[];
    if (platform === 'youtube') {
      const uploads = await deps.youtubeClient.getChannelUploads(handle);
      channelPosts = uploads.map((v) => ({
        captionOrTitle: v.title,
        publishedAt: v.publishedAt,
        durationSeconds: v.durationSeconds,
        viewCount: v.viewCount,
        likeCount: v.likeCount,
        commentCount: v.commentCount,
      }));
    } else {
      const posts = await deps.scraperClient.fetchProfilePosts(platform, handle);
      channelPosts = posts.map((p) => ({
        captionOrTitle: p.caption,
        publishedAt: p.publishedAt,
        durationSeconds: p.durationSeconds ?? 0,
        viewCount: p.viewCount,
        likeCount: p.likeCount,
        commentCount: p.commentCount,
      }));
    }

    if (channelPosts.length === 0) {
      // A real, costly fetch ran and genuinely found no public posts to
      // analyze -- not our own failure, so the rate-limit event is NOT
      // released; it's a legitimate use of today's attempt. Mirrors
      // lib/ideas/handler.ts's identical "zero ideas" rule.
      return { status: 422, body: { error: "That channel doesn't have any public posts we could analyze." } };
    }

    const cadence = computeCadence(channelPosts);
    const formatMix = computeFormatMix(channelPosts);
    const averageEngagementRate = computeAverageEngagementRate(platform, channelPosts);
    const topPosts = [...channelPosts]
      .sort((a, b) => b.viewCount - a.viewCount)
      .slice(0, 3)
      .map((p) => ({ captionOrTitle: p.captionOrTitle, viewCount: p.viewCount }));

    const generated = await deps.claudeStrategyClient.generateStrategyBreakdown({
      platform,
      channelHandle: handle,
      cadence,
      formatMix,
      averageEngagementRate,
      topPosts,
    });

    const saved = await deps.saveStrategyBreakdown({
      profileId: context.profileId,
      platform,
      channelHandle: handle,
      channelUrl: context.url,
      postCount: channelPosts.length,
      cadence,
      formatMix,
      topPosts,
      headline: generated.headline,
      explanation: generated.explanation,
    });

    return { status: 200, body: { id: saved.id } };
  } catch (err) {
    await releaseRateLimitEventIfNeeded({ store: deps.rateLimitStore, eventId: rateLimitResult.eventId });
    throw err;
  }
}
