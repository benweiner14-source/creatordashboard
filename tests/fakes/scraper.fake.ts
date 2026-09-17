import type { ScraperClient, SocialPostMetadata, ProfilePost, DownloadedVideo } from '@/lib/integrations/scraper';
import { detectSocialPlatform, PlatformNotSupportedError } from '@/lib/integrations/scraper';

export function createFakeScraperClient(
  overrides: Partial<SocialPostMetadata> = {},
  profilePosts: ProfilePost[] = [],
  downloadedVideo: Partial<DownloadedVideo> = {}
): ScraperClient {
  const metadata: SocialPostMetadata = {
    platform: 'tiktok',
    id: 'fake-post-id',
    caption: 'Wait for it... #hook',
    publishedAt: '2026-08-05T19:00:00Z',
    durationSeconds: 28,
    viewCount: 12000,
    likeCount: 900,
    commentCount: 60,
    ...overrides,
  };
  const video: DownloadedVideo = {
    videoUrl: 'https://api.apify.com/v2/key-value-stores/fake/records/video-fake.mp4?token=fake-token',
    durationSeconds: 28,
    transcript: 'This is a fake transcript.',
    ...downloadedVideo,
  };
  return {
    detectPlatform: detectSocialPlatform,
    fetchPost: async () => metadata,
    fetchProfilePosts: async () => profilePosts,
    fetchVideoForAnalysis: async (platform) => {
      if (platform === 'instagram') {
        throw new PlatformNotSupportedError('instagram');
      }
      return video;
    },
  };
}
