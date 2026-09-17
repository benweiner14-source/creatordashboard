export interface VideoMetadata {
  id: string;
  title: string;
  description: string;
  publishedAt: string;
  durationSeconds: number;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  tags: string[];
  channelId: string;
}

/**
 * A well-formed handle that simply doesn't resolve to a real channel —
 * distinct from a YouTube API/network failure, because it's the caller's
 * input that's wrong, not our infrastructure. Callers (see
 * lib/strategy/handler.ts) surface this as a friendly "we couldn't find that
 * channel" rather than a generic 500.
 */
export class ChannelNotFoundError extends Error {
  constructor(handle: string) {
    super(`No YouTube channel found for handle ${handle}`);
    this.name = 'ChannelNotFoundError';
  }
}

export interface ChannelStats {
  subscriberCount: number | null;
  totalViewCount: number;
  videoCount: number;
}

export interface YouTubeClient {
  extractVideoId(url: string): string | null;
  getVideoMetadata(videoId: string): Promise<VideoMetadata>;
  /**
   * Public channel uploads — no OAuth needed, works off the same API key
   * as getVideoMetadata. Bounded to maxResults regardless of channel size;
   * callers filter further to a target month. See spec §2.2.
   */
  getChannelUploads(handle: string, maxResults?: number): Promise<VideoMetadata[]>;
  /**
   * Channel-level totals (subscribers, lifetime views, video count) — a
   * separate API call from getChannelUploads, which only ever requests
   * contentDetails. See lib/watchlist/handler.ts for the caller.
   */
  getChannelStats(handle: string): Promise<ChannelStats>;
  /**
   * Subscriber count by channel ID, not handle — Diagnostic only ever has a
   * channelId from a video lookup, unlike Watchlist's getChannelStats(handle)
   * which resolves from a stored handle. See design spec §2.
   */
  getChannelSubscriberCount(channelId: string): Promise<number | null>;
}

export function extractYouTubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'youtu.be') {
      return parsed.pathname.slice(1) || null;
    }
    if (parsed.hostname.includes('youtube.com')) {
      if (parsed.pathname === '/watch') {
        return parsed.searchParams.get('v');
      }
      if (parsed.pathname.startsWith('/shorts/')) {
        return parsed.pathname.split('/')[2] ?? null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function parseIso8601Duration(iso: string): number {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!match) return 0;
  const [, hours, minutes, seconds] = match;
  return (Number(hours) || 0) * 3600 + (Number(minutes) || 0) * 60 + (Number(seconds) || 0);
}

function mapVideoItem(item: {
  id: string;
  snippet: { title: string; description: string; publishedAt: string; tags?: string[]; channelId: string };
  statistics: { viewCount?: string; likeCount?: string; commentCount?: string };
  contentDetails: { duration: string };
}): VideoMetadata {
  return {
    id: item.id,
    title: item.snippet.title,
    description: item.snippet.description,
    publishedAt: item.snippet.publishedAt,
    durationSeconds: parseIso8601Duration(item.contentDetails.duration),
    viewCount: Number(item.statistics.viewCount ?? 0),
    likeCount: Number(item.statistics.likeCount ?? 0),
    commentCount: Number(item.statistics.commentCount ?? 0),
    tags: item.snippet.tags ?? [],
    channelId: item.snippet.channelId,
  };
}

async function fetchYouTubeJson(url: URL): Promise<any> {
  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`YouTube API request failed with status ${response.status}`);
  }
  return response.json();
}

const CHANNEL_UPLOADS_MAX_RESULTS = 50;

export function createYouTubeClient(apiKey: string): YouTubeClient {
  return {
    extractVideoId: extractYouTubeVideoId,
    async getVideoMetadata(videoId: string): Promise<VideoMetadata> {
      const url = new URL('https://www.googleapis.com/youtube/v3/videos');
      url.searchParams.set('id', videoId);
      url.searchParams.set('part', 'snippet,statistics,contentDetails');
      url.searchParams.set('key', apiKey);

      const data = await fetchYouTubeJson(url);
      const item = data.items?.[0];
      if (!item) {
        throw new Error(`No YouTube video found for id ${videoId}`);
      }
      return mapVideoItem({ ...item, id: videoId });
    },
    async getChannelUploads(handle: string, maxResults = CHANNEL_UPLOADS_MAX_RESULTS): Promise<VideoMetadata[]> {
      const cleanHandle = handle.startsWith('@') ? handle : `@${handle}`;

      const channelsUrl = new URL('https://www.googleapis.com/youtube/v3/channels');
      channelsUrl.searchParams.set('part', 'contentDetails');
      channelsUrl.searchParams.set('forHandle', cleanHandle);
      channelsUrl.searchParams.set('key', apiKey);
      const channelsData = await fetchYouTubeJson(channelsUrl);
      const channel = channelsData.items?.[0];
      if (!channel) {
        throw new ChannelNotFoundError(handle);
      }
      const uploadsPlaylistId = channel.contentDetails.relatedPlaylists.uploads;

      const playlistUrl = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
      playlistUrl.searchParams.set('part', 'contentDetails');
      playlistUrl.searchParams.set('playlistId', uploadsPlaylistId);
      playlistUrl.searchParams.set('maxResults', String(maxResults));
      playlistUrl.searchParams.set('key', apiKey);
      const playlistData = await fetchYouTubeJson(playlistUrl);
      const videoIds: string[] = (playlistData.items ?? []).map((i: any) => i.contentDetails.videoId);
      if (videoIds.length === 0) return [];

      const videosUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
      videosUrl.searchParams.set('id', videoIds.join(','));
      videosUrl.searchParams.set('part', 'snippet,statistics,contentDetails');
      videosUrl.searchParams.set('key', apiKey);
      const videosData = await fetchYouTubeJson(videosUrl);
      return (videosData.items ?? []).map((item: any, index: number) =>
        mapVideoItem({ ...item, id: item.id ?? videoIds[index] })
      );
    },
    async getChannelStats(handle: string): Promise<ChannelStats> {
      const cleanHandle = handle.startsWith('@') ? handle : `@${handle}`;
      const channelsUrl = new URL('https://www.googleapis.com/youtube/v3/channels');
      channelsUrl.searchParams.set('part', 'statistics');
      channelsUrl.searchParams.set('forHandle', cleanHandle);
      channelsUrl.searchParams.set('key', apiKey);
      const data = await fetchYouTubeJson(channelsUrl);
      const channel = data.items?.[0];
      if (!channel) {
        throw new ChannelNotFoundError(handle);
      }
      const stats = channel.statistics ?? {};
      return {
        subscriberCount: stats.hiddenSubscriberCount ? null : Number(stats.subscriberCount ?? 0),
        totalViewCount: Number(stats.viewCount ?? 0),
        videoCount: Number(stats.videoCount ?? 0),
      };
    },
    async getChannelSubscriberCount(channelId: string): Promise<number | null> {
      const url = new URL('https://www.googleapis.com/youtube/v3/channels');
      url.searchParams.set('id', channelId);
      url.searchParams.set('part', 'statistics');
      url.searchParams.set('key', apiKey);
      const data = await fetchYouTubeJson(url);
      const channel = data.items?.[0];
      if (!channel) {
        throw new ChannelNotFoundError(channelId);
      }
      const stats = channel.statistics ?? {};
      return stats.hiddenSubscriberCount ? null : Number(stats.subscriberCount ?? 0);
    },
  };
}
