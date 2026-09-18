import type { RateLimitStore } from '@/lib/rate-limit';
import { checkAndRecordRateLimit, releaseRateLimitEvent, hashIp } from '@/lib/rate-limit';
import type { YouTubeClient } from '@/lib/integrations/youtube';
import type { ScraperClient } from '@/lib/integrations/scraper';
import type { ClaudeReportClient } from '@/lib/integrations/claude';
import { generateDiagnosticReport, type DiagnosticReport } from '@/lib/diagnostic/report';
import { describeReachRelativeToHistory } from '@/lib/diagnostic/reach-history';

export interface DiagnosticHandlerDeps {
  rateLimitStore: RateLimitStore;
  youtubeClient: YouTubeClient;
  scraperClient: ScraperClient;
  claudeClient: ClaudeReportClient;
  ipSalt: string;
  saveDiagnostic: (params: {
    profileId: string;
    platform: 'youtube' | 'tiktok' | 'instagram';
    inputUrl: string;
    report: DiagnosticReport;
  }) => Promise<{ id: string }>;
  /**
   * This profile's most recent prior Reach scores (0-100), most-recent-first,
   * excluding the diagnostic currently being generated -- used only to add
   * an extra narrative reason (reach-history.ts), never to change the
   * numeric Reach score itself. Bounded to a small window (e.g. last 20) by
   * the implementation, not by this handler.
   */
  getRecentReachScores: (profileId: string) => Promise<number[]>;
}

export interface DiagnosticRequestContext {
  profileId: string | null;
  ip: string;
  url: string;
}

export interface DiagnosticHandlerResult {
  status: number;
  body: Record<string, unknown>;
}

async function releaseIfNeeded(store: RateLimitStore, eventId: string | undefined): Promise<void> {
  if (!eventId) return;
  try {
    await releaseRateLimitEvent({ store, eventId });
  } catch (releaseErr) {
    // A failed compensating release is logged, not thrown: the original
    // error/response is what the caller needs to see. Worst case, the
    // event stays recorded and the profile's slot is consumed by this
    // failure — the same outcome the pre-atomicity code always had, not a
    // regression introduced by adding this compensation.
    console.error('Failed to release rate limit event:', releaseErr);
  }
}

export async function handleDiagnosticRequest(
  deps: DiagnosticHandlerDeps,
  context: DiagnosticRequestContext
): Promise<DiagnosticHandlerResult> {
  if (!context.profileId) {
    return { status: 401, body: { error: 'You must be signed in to run a diagnostic.' } };
  }

  const ipHash = hashIp(context.ip, deps.ipSalt);
  const rateLimitResult = await checkAndRecordRateLimit({
    store: deps.rateLimitStore,
    profileId: context.profileId,
    ipHash,
    eventType: 'diagnostic_request',
  });

  if (!rateLimitResult.allowed) {
    return {
      status: 429,
      body: {
        error:
          rateLimitResult.reason === 'ip_limit'
            ? 'Too many diagnostics have been requested from this network recently. Please try again later.'
            : 'You have already used your free diagnostic for this 30-day period.',
        retryAfter: rateLimitResult.retryAfter?.toISOString(),
      },
    };
  }

  const eventId = rateLimitResult.eventId;

  try {
    let platform: 'youtube' | 'tiktok' | 'instagram' | null = null;
    let postStats: Parameters<typeof generateDiagnosticReport>[0]['postStats'] | null = null;

    const youtubeId = deps.youtubeClient.extractVideoId(context.url);
    if (youtubeId) {
      platform = 'youtube';
      const metadata = await deps.youtubeClient.getVideoMetadata(youtubeId);
      let subscriberCount: number | null = null;
      try {
        subscriberCount = await deps.youtubeClient.getChannelSubscriberCount(metadata.channelId);
      } catch (err) {
        // Never let a follower-count lookup fail the whole diagnostic — spec §6.
        console.error('YouTube subscriber-count lookup failed; omitting Reach:', err instanceof Error ? err.message : err);
      }
      postStats = {
        captionOrTitle: metadata.title,
        publishedAt: metadata.publishedAt,
        durationSeconds: metadata.durationSeconds,
        viewCount: metadata.viewCount,
        likeCount: metadata.likeCount,
        commentCount: metadata.commentCount,
        followerCount: subscriberCount ?? undefined,
      };
    } else {
      const detected = deps.scraperClient.detectPlatform(context.url);
      if (!detected) {
        await releaseIfNeeded(deps.rateLimitStore, eventId);
        return { status: 400, body: { error: 'That link is not a supported YouTube, TikTok, or Instagram URL.' } };
      }
      platform = detected;
      const post = await deps.scraperClient.fetchPost(context.url);
      postStats = {
        captionOrTitle: post.caption,
        publishedAt: post.publishedAt,
        durationSeconds: post.durationSeconds,
        viewCount: post.viewCount,
        likeCount: post.likeCount,
        commentCount: post.commentCount,
        shareCount: post.shareCount,
        saveCount: post.saveCount,
        followerCount: post.followerCount,
      };
    }

    const report = await generateDiagnosticReport({ platform, postStats, claudeClient: deps.claudeClient });

    if (report.scores.reach) {
      const pastScores = await deps.getRecentReachScores(context.profileId);
      const historyReason = describeReachRelativeToHistory(report.scores.reach.score, pastScores);
      if (historyReason) {
        report.scores.reach = { ...report.scores.reach, reasons: [...report.scores.reach.reasons, historyReason] };
      }
    }

    const saved = await deps.saveDiagnostic({ profileId: context.profileId, platform, inputUrl: context.url, report });

    return { status: 200, body: { id: saved.id, report } };
  } catch (err) {
    await releaseIfNeeded(deps.rateLimitStore, eventId);
    throw err;
  }
}
