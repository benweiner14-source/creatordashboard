// tests/unit/app/api/oauth/route.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getUserMock = vi.fn();
const fromMock = vi.fn();
const cookieStore = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
  createSupabaseServiceRoleClient: vi.fn(() => ({ from: fromMock })),
}));

vi.mock('next/headers', () => ({
  cookies: async () => cookieStore,
}));

import { GET as authorizeGET } from '@/app/api/oauth/[platform]/authorize/route';
import { GET as callbackGET } from '@/app/api/oauth/[platform]/callback/route';
import { POST as disconnectPOST } from '@/app/api/oauth/[platform]/disconnect/route';

function makeParams(platform: string) {
  return { params: Promise.resolve({ platform }) };
}

beforeEach(() => {
  getUserMock.mockReset();
  fromMock.mockReset();
  cookieStore.get.mockReset();
  cookieStore.set.mockReset();
  cookieStore.delete.mockReset();
  process.env.TIKTOK_CLIENT_ID = 'test-tiktok-client-id';
  process.env.TIKTOK_CLIENT_SECRET = 'test-tiktok-client-secret';
  process.env.OAUTH_TOKEN_ENCRYPTION_KEY = '0'.repeat(64);
});

describe('GET /api/oauth/[platform]/authorize', () => {
  it('returns 401 when signed out', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const response = await authorizeGET(new Request('https://app.example.com/api/oauth/tiktok/authorize'), makeParams('tiktok'));
    expect(response.status).toBe(401);
  });

  it('returns 400 for an unsupported platform', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const response = await authorizeGET(new Request('https://app.example.com/api/oauth/youtube/authorize'), makeParams('youtube'));
    expect(response.status).toBe(400);
  });

  it('sets a state cookie and redirects to the provider authorize URL when signed in', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const response = await authorizeGET(new Request('https://app.example.com/api/oauth/tiktok/authorize'), makeParams('tiktok'));
    expect(response.status).toBe(307); // NextResponse.redirect default
    expect(cookieStore.set).toHaveBeenCalledTimes(1);
    const [{ name, httpOnly }] = cookieStore.set.mock.calls[0];
    expect(name).toBe('oauth_state_tiktok');
    expect(httpOnly).toBe(true);
    expect(response.headers.get('location')).toContain('www.tiktok.com');
  });
});

describe('GET /api/oauth/[platform]/callback', () => {
  it('redirects to /recap?oauthError=invalid_state for an unsupported platform', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const response = await callbackGET(
      new Request('https://app.example.com/api/oauth/youtube/callback'),
      makeParams('youtube')
    );
    expect(response.headers.get('location')).toBe('https://app.example.com/recap?oauthError=invalid_state');
  });

  it('redirects to /recap?connected=tiktok and saves the connection on a successful round trip', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    cookieStore.get.mockReturnValue({ value: 'nonce-123' });
    const upsertMock = vi.fn().mockResolvedValue({ error: null });
    fromMock.mockReturnValue({ upsert: upsertMock });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 86400 }),
      })
    );

    // The second fetch call (getProviderUserId) needs a different shape —
    // stub sequentially since both calls share the same mocked fetch.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 86400 }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { user: { open_id: 'provider-user-1' } } }) });
    vi.stubGlobal('fetch', fetchMock);

    const response = await callbackGET(
      new Request('https://app.example.com/api/oauth/tiktok/callback?code=auth-code&state=nonce-123'),
      makeParams('tiktok')
    );

    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ profile_id: 'user-1', platform: 'tiktok', provider_user_id: 'provider-user-1' }),
      { onConflict: 'profile_id,platform' }
    );
    expect(response.headers.get('location')).toBe('https://app.example.com/recap?connected=tiktok');
    expect(cookieStore.delete).toHaveBeenCalledWith('oauth_state_tiktok');

    // Prove tokens are actually encrypted before hitting the upsert, not
    // just incidentally true because the code happens to call encryptToken.
    const [upsertPayload] = upsertMock.mock.calls[0];
    expect(upsertPayload.access_token_encrypted).toBeTruthy();
    expect(upsertPayload.refresh_token_encrypted).toBeTruthy();
    expect(upsertPayload.access_token_encrypted).not.toBe('access-1');
    expect(upsertPayload.refresh_token_encrypted).not.toBe('refresh-1');

    vi.unstubAllGlobals();
  });

  it('redirects to /recap?oauthError=invalid_state when the state cookie does not match', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    cookieStore.get.mockReturnValue({ value: 'a-different-nonce' });
    const response = await callbackGET(
      new Request('https://app.example.com/api/oauth/tiktok/callback?code=auth-code&state=nonce-123'),
      makeParams('tiktok')
    );
    expect(response.headers.get('location')).toBe('https://app.example.com/recap?oauthError=invalid_state');
  });
});

describe('POST /api/oauth/[platform]/disconnect', () => {
  it('returns 401 when signed out', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const response = await disconnectPOST(new Request('https://app.example.com/api/oauth/tiktok/disconnect', { method: 'POST' }), makeParams('tiktok'));
    expect(response.status).toBe(401);
  });

  it('returns 400 for an unsupported platform', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const response = await disconnectPOST(new Request('https://app.example.com/api/oauth/youtube/disconnect', { method: 'POST' }), makeParams('youtube'));
    expect(response.status).toBe(400);
  });

  it('deletes the connection row and returns ok when signed in', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const eqPlatform = vi.fn().mockResolvedValue({ error: null });
    const eqProfile = vi.fn(() => ({ eq: eqPlatform }));
    const deleteMock = vi.fn(() => ({ eq: eqProfile }));
    // getConnectionRow's select().eq().eq().maybeSingle() chain resolves to
    // no row, so disconnectPlatform skips the best-effort revoke call.
    const maybeSingle = vi.fn().mockResolvedValue({ data: null });
    const selectEqEq = vi.fn(() => ({ maybeSingle }));
    const selectEq = vi.fn(() => ({ eq: selectEqEq }));
    const selectMock = vi.fn(() => ({ eq: selectEq }));
    fromMock.mockReturnValue({ delete: deleteMock, select: selectMock });

    const response = await disconnectPOST(new Request('https://app.example.com/api/oauth/tiktok/disconnect', { method: 'POST' }), makeParams('tiktok'));
    const body = await response.json();

    expect(body).toEqual({ ok: true });
    expect(deleteMock).toHaveBeenCalled();
    expect(eqProfile).toHaveBeenCalledWith('profile_id', 'user-1');
    expect(eqPlatform).toHaveBeenCalledWith('platform', 'tiktok');
  });

  it('returns a structured 500 when the Supabase delete fails', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const eqPlatform = vi.fn().mockResolvedValue({ error: { message: 'db unavailable' } });
    const eqProfile = vi.fn(() => ({ eq: eqPlatform }));
    const deleteMock = vi.fn(() => ({ eq: eqProfile }));
    const maybeSingle = vi.fn().mockResolvedValue({ data: null });
    const selectEqEq = vi.fn(() => ({ maybeSingle }));
    const selectEq = vi.fn(() => ({ eq: selectEqEq }));
    const selectMock = vi.fn(() => ({ eq: selectEq }));
    fromMock.mockReturnValue({ delete: deleteMock, select: selectMock });

    const response = await disconnectPOST(new Request('https://app.example.com/api/oauth/tiktok/disconnect', { method: 'POST' }), makeParams('tiktok'));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Something went wrong disconnecting that platform. Please try again.' });
  });
});
