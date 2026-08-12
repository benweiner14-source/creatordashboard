import type { RateLimitStore } from '@/lib/rate-limit';
import { checkRateLimit, recordRateLimitEvent, hashIp } from '@/lib/rate-limit';
import type { YouTubeClient } from '@/lib/integrations/youtube';
import type { ScraperClient } from '@/lib/integrations/scraper';
import type { ClaudeReportClient } from '@/lib/integrations/claude';
import { generateDiagnosticReport, type DiagnosticReport } from '@/lib/diagnostic/report';

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

export async function handleDiagnosticRequest(
  deps: DiagnosticHandlerDeps,
  context: DiagnosticRequestContext
): Promise<DiagnosticHandlerResult> {
  if (!context.profileId) {
    return { status: 401, body: { error: 'You must be signed in to run a diagnostic.' } };
  }

  const ipHash = hashIp(context.ip, deps.ipSalt);
  const rateLimitResult = await checkRateLimit({
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

  let platform: 'youtube' | 'tiktok' | 'instagram' | null = null;
  let postStats: Parameters<typeof generateDiagnosticReport>[0]['postStats'] | null = null;

  const youtubeId = deps.youtubeClient.extractVideoId(context.url);
  if (youtubeId) {
    platform = 'youtube';
    const metadata = await deps.youtubeClient.getVideoMetadata(youtubeId);
    postStats = {
      captionOrTitle: metadata.title,
      publishedAt: metadata.publishedAt,
      durationSeconds: metadata.durationSeconds,
      viewCount: metadata.viewCount,
      likeCount: metadata.likeCount,
      commentCount: metadata.commentCount,
    };
  } else {
    const detected = deps.scraperClient.detectPlatform(context.url);
    if (!detected) {
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
    };
  }

  const report = await generateDiagnosticReport({ platform, postStats, claudeClient: deps.claudeClient });
  const saved = await deps.saveDiagnostic({ profileId: context.profileId, platform, inputUrl: context.url, report });
  await recordRateLimitEvent({ store: deps.rateLimitStore, profileId: context.profileId, ipHash, eventType: 'diagnostic_request' });

  return { status: 200, body: { id: saved.id, report } };
}
