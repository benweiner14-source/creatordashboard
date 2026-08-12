import type { YouTubeClient, VideoMetadata } from '@/lib/integrations/youtube';

export function createFakeYouTubeClient(overrides: Partial<VideoMetadata> = {}): YouTubeClient {
  const metadata: VideoMetadata = {
    id: 'fake-video-id',
    title: 'How to hook viewers in 3 seconds',
    description: 'A tutorial about hooks',
    publishedAt: '2026-08-05T19:00:00Z',
    durationSeconds: 180,
    viewCount: 5000,
    likeCount: 400,
    commentCount: 50,
    tags: ['tutorial'],
    ...overrides,
  };
  return {
    extractVideoId: (url: string) => (url.includes('youtube') ? 'fake-video-id' : null),
    getVideoMetadata: async () => metadata,
  };
}
