import type { DiscoveredPost, DiscoveryResult } from '../types';

const GTA6_QUERY = '"GTA 6" OR "GTA VI" OR "Grand Theft Auto 6"';

interface YoutubeSearchItem {
  id: { videoId: string };
}

interface YoutubeVideoItem {
  id: string;
  snippet: { title: string; publishedAt: string };
  statistics: { viewCount?: string; likeCount?: string; commentCount?: string };
}

export function normalizeYoutubeVideo(item: YoutubeVideoItem): DiscoveredPost {
  const viewCount = Number(item.statistics.viewCount ?? 0);
  const likeCount = Number(item.statistics.likeCount ?? 0);
  const commentCount = Number(item.statistics.commentCount ?? 0);
  return {
    platform: 'youtube',
    externalPostId: item.id,
    url: `https://www.youtube.com/watch?v=${item.id}`,
    captionOrTitle: item.snippet.title,
    viewCount,
    engagementCount: likeCount + commentCount,
    publishedAt: item.snippet.publishedAt,
  };
}

/**
 * Two-call shape, matching lib/integrations/youtube.ts's existing
 * convention of a separate call per capability rather than widening one
 * call's `part` param: search.list finds candidate video IDs (100 quota
 * units), videos.list fetches their stats (1 unit). At the currently
 * scheduled cadence (daily; hourly once on Vercel Pro — see the comment
 * above app/api/cron/warroom/route.ts's maxDuration) this stays well
 * under the default 10,000/day quota — see design spec §2.
 */
export async function searchGta6Videos(apiKey: string, publishedAfter: Date): Promise<DiscoveryResult> {
  const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
  searchUrl.searchParams.set('part', 'id');
  searchUrl.searchParams.set('q', GTA6_QUERY);
  searchUrl.searchParams.set('type', 'video');
  searchUrl.searchParams.set('order', 'date');
  searchUrl.searchParams.set('publishedAfter', publishedAfter.toISOString());
  searchUrl.searchParams.set('maxResults', '25');
  searchUrl.searchParams.set('key', apiKey);

  const searchResponse = await fetch(searchUrl.toString());
  if (!searchResponse.ok) {
    // Include the body: the cron's budget-exceeded detection regex
    // (lib/warroom/cron-handler.ts) matches on this message, and the actual
    // quota/limit text lives in the response body, not the status code.
    const body = await searchResponse.text().catch(() => '');
    throw new Error(`YouTube search.list request failed with status ${searchResponse.status}: ${body.slice(0, 500)}`);
  }
  const searchData = await searchResponse.json();
  const videoIds: string[] = (searchData.items ?? [])
    .map((item: YoutubeSearchItem) => item.id?.videoId)
    .filter((id: string | undefined): id is string => Boolean(id));

  if (videoIds.length === 0) return { posts: [], errors: [] };

  const videosUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
  videosUrl.searchParams.set('part', 'snippet,statistics');
  videosUrl.searchParams.set('id', videoIds.join(','));
  videosUrl.searchParams.set('key', apiKey);

  const videosResponse = await fetch(videosUrl.toString());
  if (!videosResponse.ok) {
    const body = await videosResponse.text().catch(() => '');
    throw new Error(`YouTube videos.list request failed with status ${videosResponse.status}: ${body.slice(0, 500)}`);
  }
  const videosData = await videosResponse.json();
  const posts = (videosData.items ?? []).map((item: YoutubeVideoItem) => normalizeYoutubeVideo(item));

  return { posts, errors: [] };
}
