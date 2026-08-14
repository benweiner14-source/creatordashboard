import { checkAndRecordRateLimit, releaseRateLimitEventIfNeeded, hashIp, type RateLimitStore } from '@/lib/rate-limit';
import type { YouTubeClient } from '@/lib/integrations/youtube';
import type { ScraperClient, ProfilePost } from '@/lib/integrations/scraper';
import { filterPostsToMonth, aggregateRecap } from './aggregate';
import type { AggregatablePost, PlatformTotals, RecapCardRow, RecapHandles, RecapPlatform, RecapTopPost } from './types';

export const RECAP_GENERATION_PROFILE_LIMIT = 5;
export const RECAP_GENERATION_IP_LIMIT = 10;

type OAuthConnectedPlatform = 'tiktok' | 'instagram';

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
  /**
   * Returns the connection state for a platform: 'connected' with an
   * access token if OAuth is usable right now, 'not_connected' if there's
   * no connection (or it couldn't be used this request — decrypt
   * failure, transient refresh error), or 'connection_expired' if the
   * platform WAS connected but its refresh token has been definitively
   * invalidated by the provider (the connection row has already been
   * deleted by this point). See
   * docs/superpowers/specs/2026-08-14-oauth-fast-follow-design.md §3.
   */
  getPlatformConnection: (
    profileId: string,
    platform: OAuthConnectedPlatform
  ) => Promise<
    | { status: 'connected'; accessToken: string }
    | { status: 'not_connected' }
    | { status: 'connection_expired' }
  >;
  oauthClients: Record<OAuthConnectedPlatform, { fetchProfilePosts: (accessToken: string) => Promise<ProfilePost[]> }>;
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

  // Fetched once up front — both for the "is anything connected" gate
  // below and reused in the fetch loop, so a connected platform's token
  // is never refreshed twice in one request. See spec §4.
  const oauthConnections: Partial<Record<OAuthConnectedPlatform, { accessToken: string }>> = {};
  const connectionWarnings: string[] = [];
  for (const platform of ['tiktok', 'instagram'] as const) {
    const result = await deps.getPlatformConnection(context.profileId, platform);
    if (result.status === 'connected') {
      oauthConnections[platform] = { accessToken: result.accessToken };
    } else if (result.status === 'connection_expired') {
      connectionWarnings.push(`${platform}_connection_expired`);
    }
  }

  const connected = (['youtube', 'tiktok', 'instagram'] as const).filter(
    (p) => handles[p] || (p !== 'youtube' && oauthConnections[p as OAuthConnectedPlatform])
  );
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
    const warnings: string[] = [...connectionWarnings];
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
      const connection = oauthConnections[platform];
      if (!connection && !handle) continue;
      try {
        const posts = connection
          ? await deps.oauthClients[platform].fetchProfilePosts(connection.accessToken)
          : await deps.scraperClient.fetchProfilePosts(platform, handle!);
        if (connection && platform === 'instagram') {
          // Instagram's OAuth API (instagram_business_basic scope) doesn't
          // expose view counts without a separate Insights permission this
          // app doesn't request — every Instagram post fetched via OAuth
          // reports viewCount: 0, which would silently understate totals and
          // prevent Instagram posts from ever winning "top post" if left
          // unflagged. See lib/integrations/instagram-oauth.ts.
          warnings.push('instagram_views_unavailable');
        }
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
      // `warnings` now also carries non-failure entries (`_connection_expired`
      // for a platform that may not even be in `connected`, `_views_unavailable`
      // on an outright successful fetch) — only `_scrape_failed` entries mean
      // "this connected platform's fetch actually threw", so the outage check
      // below counts just those, not the array's full length.
      const scrapeFailureCount = warnings.filter((w) => w.endsWith('_scrape_failed')).length;
      if (scrapeFailureCount === connected.length) {
        // Every connected platform's fetch *threw*. That leaves
        // postsByPlatform empty exactly like a genuinely quiet month, but
        // it is our failure, not a real result — so the attempt is given
        // back, and the creator is told what actually happened rather
        // than being told they published nothing.
        await releaseRateLimitEventIfNeeded({ store: deps.rateLimitStore, eventId: rateLimitResult.eventId });
        return {
          status: 503,
          body: { error: "We couldn't reach any of your connected platforms. Please try again in a bit.", warnings },
        };
      }
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
