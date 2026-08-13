import type { ScraperClient, SocialPostMetadata, ProfilePost } from '@/lib/integrations/scraper';
import { detectSocialPlatform } from '@/lib/integrations/scraper';

export function createFakeScraperClient(
  overrides: Partial<SocialPostMetadata> = {},
  profilePosts: ProfilePost[] = []
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
  return {
    detectPlatform: detectSocialPlatform,
    fetchPost: async () => metadata,
    fetchProfilePosts: async () => profilePosts,
  };
}
