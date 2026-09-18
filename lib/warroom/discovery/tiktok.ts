import type { DiscoveredPost, DiscoveryResult } from '../types';
import { GTA6_BIG_ACCOUNTS_TIKTOK } from './big-accounts';

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
    // Include the body: the cron's budget-exceeded detection regex
    // (lib/warroom/cron-handler.ts) matches on this message, and Apify puts
    // the real "monthly usage hard limit exceeded" text in the body.
    const body = await response.text().catch(() => '');
    throw new Error(`Apify TikTok scraper request failed with status ${response.status}: ${body.slice(0, 500)}`);
  }
  const rawItems = await response.json();
  // A 200 whose body is not an array (e.g. an error object) degrades to zero
  // posts rather than throwing "items is not iterable" below.
  const items: RawTikTokItem[] = Array.isArray(rawItems) ? rawItems : [];

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

/**
 * The reference Social War Room system's curated "big account" profile-scrape
 * mode (design spec §2/§9 non-goal, now implemented as a fast-follow) — same
 * actor as searchGta6TikToks, but scraping a known list of profiles directly
 * instead of hashtag/keyword search. Every returned post is marked
 * isBigAccount so scoring.ts applies the looser, reference-tuned threshold
 * tier for known accounts.
 */
export async function searchGta6TikTokBigAccounts(apifyToken: string): Promise<DiscoveryResult> {
  const url = new URL('https://api.apify.com/v2/acts/clockworks~tiktok-scraper/run-sync-get-dataset-items');
  url.searchParams.set('token', apifyToken);
  url.searchParams.set('timeout', '240');

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      profiles: GTA6_BIG_ACCOUNTS_TIKTOK.map((handle) => `https://www.tiktok.com/@${handle}`),
      resultsType: 'posts',
      maxItems: 45,
      shouldDownloadVideos: false,
      shouldDownloadCovers: false,
      publishTime: 'LAST_24H',
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Apify TikTok scraper request failed with status ${response.status}: ${body.slice(0, 500)}`);
  }
  const rawItems = await response.json();
  const items: RawTikTokItem[] = Array.isArray(rawItems) ? rawItems : [];

  const posts: DiscoveredPost[] = [];
  const errors: string[] = [];
  for (const item of items) {
    if (item.error) {
      if (!BENIGN_ERRORS.has(item.error)) errors.push(item.error);
      continue;
    }
    const normalized = normalizeTikTokPost(item);
    if (normalized) posts.push({ ...normalized, isBigAccount: true });
  }
  return { posts, errors };
}
