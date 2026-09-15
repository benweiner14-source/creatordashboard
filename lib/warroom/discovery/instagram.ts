import type { DiscoveredPost, DiscoveryResult } from '../types';

const BENIGN_ERRORS = new Set(['not_found', 'no_items', 'restricted_page']);

interface RawInstagramItem {
  shortCode?: string;
  id?: string;
  likesCount?: number;
  likeCount?: number;
  commentsCount?: number;
  commentCount?: number;
  videoViewCount?: number;
  viewsCount?: number;
  url?: string;
  caption?: string;
  timestamp?: string | number;
  takenAtTimestamp?: number;
  ownerUsername?: string;
  error?: string;
}

export function normalizeInstagramPost(item: RawInstagramItem): DiscoveredPost | null {
  const shortCode = item.shortCode ?? item.id;
  const ts = item.timestamp ?? item.takenAtTimestamp;
  if (!shortCode || !ts) return null;
  const likes = item.likesCount ?? item.likeCount ?? 0;
  const comments = item.commentsCount ?? item.commentCount ?? 0;
  const views = item.videoViewCount ?? item.viewsCount ?? 0;
  const publishedMs = typeof ts === 'number' ? ts * 1000 : new Date(ts).getTime();
  return {
    platform: 'instagram',
    externalPostId: shortCode,
    url: item.url ?? `https://www.instagram.com/p/${shortCode}/`,
    captionOrTitle: (item.caption ?? '').slice(0, 300),
    viewCount: views,
    engagementCount: likes + comments,
    publishedAt: new Date(publishedMs).toISOString(),
  };
}

/** Same actor and call shape as the reference system (design spec §2). */
export async function searchGta6InstagramPosts(apifyToken: string): Promise<DiscoveryResult> {
  const url = new URL('https://api.apify.com/v2/acts/apify~instagram-hashtag-scraper/run-sync-get-dataset-items');
  url.searchParams.set('token', apifyToken);
  url.searchParams.set('maxItems', '50');
  url.searchParams.set('timeout', '90');

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hashtags: ['gta6', 'gtavi', 'grandtheftauto6'], resultsLimit: 50, searchType: 'hashtag' }),
  });
  if (!response.ok) {
    // Include the body: the cron's budget-exceeded detection regex
    // (lib/warroom/cron-handler.ts) matches on this message, and Apify puts
    // the real "monthly usage hard limit exceeded" text in the body.
    const body = await response.text().catch(() => '');
    throw new Error(`Apify Instagram scraper request failed with status ${response.status}: ${body.slice(0, 500)}`);
  }
  const rawItems = await response.json();
  // A 200 whose body is not an array (e.g. an error object) degrades to zero
  // posts rather than throwing "items is not iterable" below.
  const items: RawInstagramItem[] = Array.isArray(rawItems) ? rawItems : [];

  const posts: DiscoveredPost[] = [];
  const errors: string[] = [];
  for (const item of items) {
    if (item.error) {
      if (!BENIGN_ERRORS.has(item.error)) errors.push(item.error);
      continue;
    }
    const normalized = normalizeInstagramPost(item);
    if (normalized) posts.push(normalized);
  }
  return { posts, errors };
}
