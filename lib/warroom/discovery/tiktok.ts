import type { DiscoveredPost, DiscoveryResult } from '../types';

// Same class of benign, non-failure markers the reference Social War Room
// system's Health Check ignores (design spec §2/§4) — a "no results found"
// or "page restricted" item is not a scraper failure.
const BENIGN_ERRORS = new Set(['not_found', 'no_items', 'restricted_page']);

interface RawTikTokItem {
  id?: string | number;
  playCount?: number;
  diggCount?: number;
  commentCount?: number;
  shareCount?: number;
  text?: string;
  webVideoUrl?: string;
  authorMeta?: { uniqueId?: string };
  createTime?: number;
  error?: string;
}

export function normalizeTikTokPost(item: RawTikTokItem): DiscoveredPost | null {
  if (!item.id || !item.createTime) return null;
  const views = item.playCount ?? 0;
  const likes = item.diggCount ?? 0;
  const comments = item.commentCount ?? 0;
  const shares = item.shareCount ?? 0;
  const handle = item.authorMeta?.uniqueId ?? 'unknown';
  const videoId = String(item.id);
  return {
    platform: 'tiktok',
    externalPostId: videoId,
    url: item.webVideoUrl ?? `https://www.tiktok.com/@${handle}/video/${videoId}`,
    captionOrTitle: (item.text ?? '').slice(0, 300),
    viewCount: views,
    engagementCount: likes + comments + shares,
    publishedAt: new Date(item.createTime * 1000).toISOString(),
  };
}

/**
 * Same actor and call shape as the reference Social War Room system
 * (design spec §2), GTA6 keywords substituted for NBA2K's.
 */
export async function searchGta6TikToks(apifyToken: string): Promise<DiscoveryResult> {
  const url = new URL('https://api.apify.com/v2/acts/clockworks~tiktok-scraper/run-sync-get-dataset-items');
  url.searchParams.set('token', apifyToken);
  url.searchParams.set('maxItems', '30');
  url.searchParams.set('timeout', '90');

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      hashtags: ['gta6', 'gta 6', 'grandtheftauto6', 'gtavi'],
      searchQueries: ['GTA 6', 'GTA VI', 'Grand Theft Auto 6'],
      maxItems: 30,
      shouldDownloadVideos: false,
      shouldDownloadCovers: false,
      publishTime: 'LAST_24H',
    }),
  });
  if (!response.ok) {
    throw new Error(`Apify TikTok scraper request failed with status ${response.status}`);
  }
  const items: RawTikTokItem[] = await response.json();

  const posts: DiscoveredPost[] = [];
  const errors: string[] = [];
  for (const item of items) {
    if (item.error) {
      if (!BENIGN_ERRORS.has(item.error)) errors.push(item.error);
      continue;
    }
    const normalized = normalizeTikTokPost(item);
    if (normalized) posts.push(normalized);
  }
  return { posts, errors };
}
