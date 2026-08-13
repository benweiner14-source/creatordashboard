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

export interface ScraperClient {
  detectPlatform(url: string): 'tiktok' | 'instagram' | null;
  fetchPost(url: string): Promise<SocialPostMetadata>;
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

export function createApifyScraperClient(apiToken: string): ScraperClient {
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
  };
}
