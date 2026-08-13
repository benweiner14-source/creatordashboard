export interface SocialPostMetadata {
  platform: 'tiktok' | 'instagram';
  id: string;
  caption: string;
  publishedAt: string;
  durationSeconds: number;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  // Only populated for TikTok — Apify's TikTok scraper exposes shareCount
  // and collectCount (saves), but Instagram doesn't publicly expose either,
  // even to scrapers. See
  // docs/superpowers/specs/2026-08-13-diagnostic-benchmark-sources.md.
  shareCount?: number;
  saveCount?: number;
}

export interface ProfilePost {
  platform: 'tiktok' | 'instagram';
  id: string;
  caption: string;
  publishedAt: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  permalink: string;
}

export interface ScraperClient {
  detectPlatform(url: string): 'tiktok' | 'instagram' | null;
  fetchPost(url: string): Promise<SocialPostMetadata>;
  /**
   * Bounded, async-run profile scrape — distinct from fetchPost's sync
   * single-post call because a profile crawl runs long enough to risk the
   * sync endpoint's response-timeout ceiling. See spec §2.1.
   */
  fetchProfilePosts(platform: 'tiktok' | 'instagram', handle: string): Promise<ProfilePost[]>;
}

export function detectSocialPlatform(url: string): 'tiktok' | 'instagram' | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('tiktok.com')) return 'tiktok';
    if (parsed.hostname.includes('instagram.com')) return 'instagram';
    return null;
  } catch {
    return null;
  }
}

const APIFY_ACTORS: Record<'tiktok' | 'instagram', string> = {
  tiktok: 'clockworks~tiktok-scraper',
  instagram: 'apify~instagram-scraper',
};

// Bounds cost per creator regardless of how prolific they are — the
// month-filter in lib/recap/aggregate.ts then narrows this down further.
// See spec §2.1.
const PROFILE_SCRAPE_RESULTS_LIMIT = 50;
const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_MAX_POLL_ATTEMPTS = 30;
const DEFAULT_RETRY_ATTEMPTS = 1;

export interface ApifyScraperOptions {
  pollIntervalMs?: number;
  maxPollAttempts?: number;
  retryAttempts?: number;
  /** Injectable for tests — defaults to a real setTimeout-based delay. */
  sleep?: (ms: number) => Promise<void>;
}

function profileUrlFor(platform: 'tiktok' | 'instagram', handle: string): string {
  const cleanHandle = handle.replace(/^@/, '');
  return platform === 'tiktok'
    ? `https://www.tiktok.com/@${cleanHandle}`
    : `https://www.instagram.com/${cleanHandle}/`;
}

function normalizeProfilePost(platform: 'tiktok' | 'instagram', item: Record<string, unknown>): ProfilePost {
  return {
    platform,
    id: String(item.id ?? item.videoId ?? item.shortCode ?? ''),
    caption: String(item.text ?? item.caption ?? ''),
    publishedAt: String(item.createTimeISO ?? item.timestamp ?? ''),
    viewCount: Number(item.playCount ?? item.videoViewCount ?? item.viewCount ?? 0),
    likeCount: Number(item.diggCount ?? item.likesCount ?? item.likeCount ?? 0),
    commentCount: Number(item.commentCount ?? 0),
    permalink: String(item.webVideoUrl ?? item.url ?? item.permalink ?? ''),
  };
}

async function runApifyActorAndWait(params: {
  actorId: string;
  apiToken: string;
  input: Record<string, unknown>;
  pollIntervalMs: number;
  maxPollAttempts: number;
  sleep: (ms: number) => Promise<void>;
}): Promise<unknown[]> {
  const startResponse = await fetch(`https://api.apify.com/v2/acts/${params.actorId}/runs?token=${params.apiToken}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params.input),
  });
  if (!startResponse.ok) {
    throw new Error(`Apify run start failed with status ${startResponse.status}`);
  }
  const startData = await startResponse.json();
  const runId = startData.data.id;
  const datasetId = startData.data.defaultDatasetId;

  for (let attempt = 0; attempt < params.maxPollAttempts; attempt++) {
    const statusResponse = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${params.apiToken}`);
    if (!statusResponse.ok) {
      throw new Error(`Apify run status check failed with status ${statusResponse.status}`);
    }
    const statusData = await statusResponse.json();
    const status = statusData.data.status;

    if (status === 'SUCCEEDED') {
      const datasetResponse = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${params.apiToken}`);
      if (!datasetResponse.ok) {
        throw new Error(`Apify dataset fetch failed with status ${datasetResponse.status}`);
      }
      return datasetResponse.json();
    }
    if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
      throw new Error(`Apify run ended with status ${status}`);
    }
    await params.sleep(params.pollIntervalMs);
  }
  throw new Error('Apify run did not finish within the polling window');
}

export function createApifyScraperClient(apiToken: string, options: ApifyScraperOptions = {}): ScraperClient {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxPollAttempts = options.maxPollAttempts ?? DEFAULT_MAX_POLL_ATTEMPTS;
  const retryAttempts = options.retryAttempts ?? DEFAULT_RETRY_ATTEMPTS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  return {
    detectPlatform: detectSocialPlatform,
    async fetchPost(url: string): Promise<SocialPostMetadata> {
      const platform = detectSocialPlatform(url);
      if (!platform) {
        throw new Error(`Unsupported social URL: ${url}`);
      }
      const actorId = APIFY_ACTORS[platform];
      const runUrl = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${apiToken}`;
      const response = await fetch(runUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startUrls: [{ url }] }),
      });
      if (!response.ok) {
        throw new Error(`Apify scrape failed with status ${response.status}`);
      }
      const items = await response.json();
      const item = items[0];
      if (!item) {
        throw new Error(`Apify returned no data for ${url}`);
      }
      return {
        platform,
        id: String(item.id ?? item.videoId ?? item.shortCode ?? url),
        caption: item.text ?? item.caption ?? '',
        publishedAt: item.createTimeISO ?? item.timestamp ?? new Date().toISOString(),
        durationSeconds: Number(item.videoDuration ?? item.duration ?? 0),
        viewCount: Number(item.playCount ?? item.videoViewCount ?? item.viewCount ?? 0),
        likeCount: Number(item.diggCount ?? item.likesCount ?? item.likeCount ?? 0),
        commentCount: Number(item.commentCount ?? 0),
        shareCount: platform === 'tiktok' && item.shareCount !== undefined ? Number(item.shareCount) : undefined,
        saveCount: platform === 'tiktok' && item.collectCount !== undefined ? Number(item.collectCount) : undefined,
      };
    },
    async fetchProfilePosts(platform: 'tiktok' | 'instagram', handle: string): Promise<ProfilePost[]> {
      const actorId = APIFY_ACTORS[platform];
      let lastError: unknown;
      for (let attempt = 0; attempt <= retryAttempts; attempt++) {
        try {
          const items = await runApifyActorAndWait({
            actorId,
            apiToken,
            input: {
              startUrls: [{ url: profileUrlFor(platform, handle) }],
              resultsLimit: PROFILE_SCRAPE_RESULTS_LIMIT,
            },
            pollIntervalMs,
            maxPollAttempts,
            sleep,
          });
          return items.map((item) => normalizeProfilePost(platform, item as Record<string, unknown>));
        } catch (err) {
          lastError = err;
          if (attempt < retryAttempts) {
            await sleep(pollIntervalMs);
          }
        }
      }
      throw lastError;
    },
  };
}
