import { checkAndRecordRateLimit, releaseRateLimitEventIfNeeded, hashIp, type RateLimitStore } from '@/lib/rate-limit';
import type { YouTubeClient } from '@/lib/integrations/youtube';
import type { ScraperClient } from '@/lib/integrations/scraper';
import { filterPostsToMonth, aggregateRecap } from './aggregate';
import type { AggregatablePost, PlatformTotals, RecapCardRow, RecapHandles, RecapPlatform, RecapTopPost } from './types';

export const RECAP_GENERATION_PROFILE_LIMIT = 5;
export const RECAP_GENERATION_IP_LIMIT = 10;

export interface RecapHandlerDeps {
  rateLimitStore: RateLimitStore;
  youtubeClient: YouTubeClient;
  scraperClient: ScraperClient;
  ipSalt: string;
  getProfileHandles: (profileId: string) => Promise<RecapHandles>;
  getExistingRecapCard: (profileId: string, month: string) => Promise<RecapCardRow | null>;
  saveRecapCard: (params: {
    profileId: string;
    month: string;
    platformData: Partial<Record<RecapPlatform, PlatformTotals>>;
    totals: PlatformTotals;
    topPost: RecapTopPost;
    warnings: string[];
  }) => Promise<RecapCardRow>;
}

export interface RecapRequestContext {
  profileId: string | null;
  ip: string;
  now: Date;
}

export interface RecapHandlerResult {
  status: number;
  body: Record<string, unknown>;
}

function monthKey(date: Date): { label: string; year: number; month: number } {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  return { label: `${year}-${String(month).padStart(2, '0')}-01`, year, month };
}

export async function handleRecapRequest(deps: RecapHandlerDeps, context: RecapRequestContext): Promise<RecapHandlerResult> {
  if (!context.profileId) {
    return { status: 401, body: { error: 'You must be signed in to generate a recap card.' } };
  }

  const handles = await deps.getProfileHandles(context.profileId);
  const connected = (['youtube', 'tiktok', 'instagram'] as const).filter((p) => handles[p]);
  if (connected.length === 0) {
    return { status: 400, body: { error: 'Connect at least one platform before generating a recap.' } };
  }

  const { label: month, year, month: monthNum } = monthKey(context.now);

  const existing = await deps.getExistingRecapCard(context.profileId, month);
  if (existing) {
    return { status: 200, body: { recapCard: existing } };
  }

  const ipHash = hashIp(context.ip, deps.ipSalt);
  const rateLimitResult = await checkAndRecordRateLimit({
    store: deps.rateLimitStore,
    profileId: context.profileId,
    ipHash,
    eventType: 'recap_generation',
    profileLimit: RECAP_GENERATION_PROFILE_LIMIT,
    ipLimit: RECAP_GENERATION_IP_LIMIT,
    windowDays: 1,
    now: context.now,
  });

  if (!rateLimitResult.allowed) {
    return {
      status: 429,
      body: {
        error:
          rateLimitResult.reason === 'ip_limit'
            ? 'Too many recap generations have been requested from this network recently. Please try again later.'
            : "You've hit today's limit for recap generation attempts. Please try again tomorrow.",
        retryAfter: rateLimitResult.retryAfter?.toISOString(),
      },
    };
  }

  try {
    const warnings: string[] = [];
    const postsByPlatform: Partial<Record<RecapPlatform, AggregatablePost[]>> = {};

    if (handles.youtube) {
      try {
        const videos = await deps.youtubeClient.getChannelUploads(handles.youtube);
        postsByPlatform.youtube = filterPostsToMonth(
          videos.map((v) => ({
            platform: 'youtube' as const,
            captionOrTitle: v.title,
            publishedAt: v.publishedAt,
            viewCount: v.viewCount,
            likeCount: v.likeCount,
            commentCount: v.commentCount,
            permalink: `https://youtube.com/watch?v=${v.id}`,
          })),
          { year, month: monthNum }
        );
      } catch (err) {
        console.error('YouTube recap fetch failed:', err);
        warnings.push('youtube_scrape_failed');
      }
    }

    for (const platform of ['tiktok', 'instagram'] as const) {
      const handle = handles[platform];
      if (!handle) continue;
      try {
        const posts = await deps.scraperClient.fetchProfilePosts(platform, handle);
        postsByPlatform[platform] = filterPostsToMonth(
          posts.map((p) => ({
            platform,
            captionOrTitle: p.caption,
            publishedAt: p.publishedAt,
            viewCount: p.viewCount,
            likeCount: p.likeCount,
            commentCount: p.commentCount,
            permalink: p.permalink,
          })),
          { year, month: monthNum }
        );
      } catch (err) {
        console.error(`${platform} recap fetch failed:`, err);
        warnings.push(`${platform}_scrape_failed`);
      }
    }

    const aggregation = aggregateRecap(postsByPlatform);
    if (!aggregation.topPost || aggregation.totals.postCount === 0) {
      // A real, costly scrape ran and genuinely found nothing this
      // month — not our own failure, so the rate-limit event is NOT
      // released; it's a legitimate use of one of today's attempts. No
      // row is written, so a later attempt this month isn't blocked by
      // the (profile, month) unique constraint. See spec §2 step 5.
      return {
        status: 422,
        body: { error: "Looks like nothing was published on your connected platforms this month yet.", warnings },
      };
    }

    const saved = await deps.saveRecapCard({
      profileId: context.profileId,
      month,
      platformData: aggregation.platformData,
      totals: aggregation.totals,
      topPost: aggregation.topPost,
      warnings,
    });

    return { status: 200, body: { recapCard: saved } };
  } catch (err) {
    await releaseRateLimitEventIfNeeded({ store: deps.rateLimitStore, eventId: rateLimitResult.eventId });
    throw err;
  }
}
