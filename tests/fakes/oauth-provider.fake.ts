import type { OAuthProviderClient, OAuthTokenSet } from '@/lib/oauth/types';
import type { ProfilePost } from '@/lib/integrations/scraper';

export function createFakeOAuthProviderClient(overrides: Partial<OAuthProviderClient> = {}): OAuthProviderClient {
  const defaultTokenSet: OAuthTokenSet = {
    accessToken: 'fake-access-token',
    refreshToken: 'fake-refresh-token',
    expiresAt: null,
  };
  const defaultPosts: ProfilePost[] = [];
  return {
    buildAuthorizeUrl: (state, redirectUri) => `https://provider.example.com/authorize?state=${state}&redirect_uri=${redirectUri}`,
    exchangeCode: async () => defaultTokenSet,
    getProviderUserId: async () => 'fake-provider-user-id',
    refreshAccessToken: async () => defaultTokenSet,
    fetchProfilePosts: async () => defaultPosts,
    ...overrides,
  };
}
