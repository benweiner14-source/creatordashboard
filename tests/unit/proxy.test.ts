// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const getUserMock = vi.fn().mockResolvedValue({ data: { user: null } });
const getAuthenticatorAssuranceLevelMock = vi.fn().mockResolvedValue({
  data: { currentLevel: 'aal1', nextLevel: 'aal1', currentAuthenticationMethods: [] },
  error: null,
});
const createServerClientMock = vi.fn((..._args: unknown[]) => ({
  auth: {
    getUser: getUserMock,
    mfa: { getAuthenticatorAssuranceLevel: getAuthenticatorAssuranceLevelMock },
  },
}));
vi.mock('@supabase/ssr', () => ({
  createServerClient: (...args: unknown[]) => createServerClientMock(...args),
}));

import { proxy } from '@/proxy';

describe('proxy', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-placeholder-key';
    getUserMock.mockClear();
    createServerClientMock.mockClear();
    getAuthenticatorAssuranceLevelMock.mockClear();
    getAuthenticatorAssuranceLevelMock.mockResolvedValue({
      data: { currentLevel: 'aal1', nextLevel: 'aal1', currentAuthenticationMethods: [] },
      error: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refreshes the session by calling getUser and returns a response', async () => {
    const request = new NextRequest('https://app.example.com/diagnostic');
    const response = await proxy(request);
    expect(getUserMock).toHaveBeenCalledTimes(1);
    expect(response).toBeInstanceOf(Response);
  });

  it('passes the request through without touching Supabase when the URL env var is missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const request = new NextRequest('https://app.example.com/');
    const response = await proxy(request);
    expect(createServerClientMock).not.toHaveBeenCalled();
    expect(getUserMock).not.toHaveBeenCalled();
    expect(response).toBeInstanceOf(Response);
  });

  it('passes the request through without touching Supabase when the anon key env var is missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const request = new NextRequest('https://app.example.com/');
    const response = await proxy(request);
    expect(createServerClientMock).not.toHaveBeenCalled();
    expect(getUserMock).not.toHaveBeenCalled();
    expect(response).toBeInstanceOf(Response);
  });

  describe('AAL2 (MFA) enforcement gate', () => {
    it('passes a request through when the account has no eligibility for aal2 (nextLevel !== aal2)', async () => {
      getAuthenticatorAssuranceLevelMock.mockResolvedValue({
        data: { currentLevel: 'aal1', nextLevel: 'aal1', currentAuthenticationMethods: [] },
        error: null,
      });
      const request = new NextRequest('https://app.example.com/home');
      const response = await proxy(request);
      expect(response.headers.get('location')).toBeNull();
      expect(response.status).not.toBe(401);
    });

    it('passes a request through when the session has already cleared aal2 (currentLevel === aal2)', async () => {
      getAuthenticatorAssuranceLevelMock.mockResolvedValue({
        data: { currentLevel: 'aal2', nextLevel: 'aal2', currentAuthenticationMethods: [] },
        error: null,
      });
      const request = new NextRequest('https://app.example.com/home');
      const response = await proxy(request);
      expect(response.headers.get('location')).toBeNull();
      expect(response.status).not.toBe(401);
    });

    it('redirects a page request to /auth/mfa-challenge with a safe next param when the aal2 gap exists', async () => {
      getAuthenticatorAssuranceLevelMock.mockResolvedValue({
        data: { currentLevel: 'aal1', nextLevel: 'aal2', currentAuthenticationMethods: [] },
        error: null,
      });
      const request = new NextRequest('https://app.example.com/home?tab=ideas');
      const response = await proxy(request);
      expect(response.status).toBe(307);
      const location = new URL(response.headers.get('location')!);
      expect(location.pathname).toBe('/auth/mfa-challenge');
      expect(location.searchParams.get('next')).toBe('/home?tab=ideas');
    });

    it('returns 401 JSON for a generic /api/* request when the aal2 gap exists', async () => {
      getAuthenticatorAssuranceLevelMock.mockResolvedValue({
        data: { currentLevel: 'aal1', nextLevel: 'aal2', currentAuthenticationMethods: [] },
        error: null,
      });
      const request = new NextRequest('https://app.example.com/api/settings/profile');
      const response = await proxy(request);
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body).toEqual({ error: 'MFA verification required.' });
    });

    it('does not redirect /auth/mfa-challenge itself even under the aal2 gap (avoids a redirect loop)', async () => {
      getAuthenticatorAssuranceLevelMock.mockResolvedValue({
        data: { currentLevel: 'aal1', nextLevel: 'aal2', currentAuthenticationMethods: [] },
        error: null,
      });
      const request = new NextRequest('https://app.example.com/auth/mfa-challenge?next=%2Fhome');
      const response = await proxy(request);
      expect(response.headers.get('location')).toBeNull();
      expect(response.status).not.toBe(401);
    });

    it('does not block the magic-link callback route under the aal2 gap', async () => {
      getAuthenticatorAssuranceLevelMock.mockResolvedValue({
        data: { currentLevel: 'aal1', nextLevel: 'aal2', currentAuthenticationMethods: [] },
        error: null,
      });
      const request = new NextRequest('https://app.example.com/auth/callback?code=abc&next=%2Fhome');
      const response = await proxy(request);
      expect(response.headers.get('location')).toBeNull();
      expect(response.status).not.toBe(401);
    });

    it.each([
      '/api/settings/mfa/factors',
      '/api/settings/mfa/verify',
      '/api/auth/sign-out',
    ])('does not block allowlisted API route %s under the aal2 gap', async (path) => {
      getAuthenticatorAssuranceLevelMock.mockResolvedValue({
        data: { currentLevel: 'aal1', nextLevel: 'aal2', currentAuthenticationMethods: [] },
        error: null,
      });
      const request = new NextRequest(`https://app.example.com${path}`);
      const response = await proxy(request);
      expect(response.status).not.toBe(401);
    });

    it('fails open (lets the request proceed) and logs when getAuthenticatorAssuranceLevel errors', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      getAuthenticatorAssuranceLevelMock.mockResolvedValue({
        data: null,
        error: new Error('transient supabase failure'),
      });
      const request = new NextRequest('https://app.example.com/home');
      const response = await proxy(request);
      expect(response.headers.get('location')).toBeNull();
      expect(response.status).not.toBe(401);
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });
});
