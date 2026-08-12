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
}

export interface YouTubeClient {
  extractVideoId(url: string): string | null;
  getVideoMetadata(videoId: string): Promise<VideoMetadata>;
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

export function createYouTubeClient(apiKey: string): YouTubeClient {
  return {
    extractVideoId: extractYouTubeVideoId,
    async getVideoMetadata(videoId: string): Promise<VideoMetadata> {
      const url = new URL('https://www.googleapis.com/youtube/v3/videos');
      url.searchParams.set('id', videoId);
      url.searchParams.set('part', 'snippet,statistics,contentDetails');
      url.searchParams.set('key', apiKey);

      const response = await fetch(url.toString());
      if (!response.ok) {
        throw new Error(`YouTube API request failed with status ${response.status}`);
      }
      const data = await response.json();
      const item = data.items?.[0];
      if (!item) {
        throw new Error(`No YouTube video found for id ${videoId}`);
      }
      return {
        id: videoId,
        title: item.snippet.title,
        description: item.snippet.description,
        publishedAt: item.snippet.publishedAt,
        durationSeconds: parseIso8601Duration(item.contentDetails.duration),
        viewCount: Number(item.statistics.viewCount ?? 0),
        likeCount: Number(item.statistics.likeCount ?? 0),
        commentCount: Number(item.statistics.commentCount ?? 0),
        tags: item.snippet.tags ?? [],
      };
    },
  };
}
