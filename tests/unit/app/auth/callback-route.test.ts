// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const exchangeCodeForSessionMock = vi.fn();
const listFactorsMock = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(() => ({
    auth: {
      exchangeCodeForSession: exchangeCodeForSessionMock,
      mfa: { listFactors: listFactorsMock },
    },
  })),
}));

import { GET } from '@/app/auth/callback/route';

describe('GET /auth/callback', () => {
  beforeEach(() => {
    exchangeCodeForSessionMock.mockReset();
    listFactorsMock.mockReset();
    listFactorsMock.mockResolvedValue({ data: { totp: [] } });
  });

  it('redirects to next on successful code exchange', async () => {
    exchangeCodeForSessionMock.mockResolvedValue({ error: null });

    const next = '/diagnostic?url=' + encodeURIComponent('https://tiktok.com/x');
    const request = new Request(
      `https://app.example.com/auth/callback?code=valid-code&next=${encodeURIComponent(next)}`
    );
    const response = await GET(request);

    expect(exchangeCodeForSessionMock).toHaveBeenCalledWith('valid-code');
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(`https://app.example.com${next}`);
  });

  it('redirects to the MFA challenge page when the user has a verified TOTP factor', async () => {
    exchangeCodeForSessionMock.mockResolvedValue({ error: null });
    listFactorsMock.mockResolvedValue({
      data: { totp: [{ id: 'factor-1', status: 'verified' }] },
    });

    const request = new Request('https://app.example.com/auth/callback?code=valid-code&next=%2Fideas');
    const response = await GET(request);

    expect(response.headers.get('location')).toBe('https://app.example.com/auth/mfa-challenge?next=%2Fideas');
  });

  it('redirects to /diagnostic with authError=expired and the preserved url on failed exchange', async () => {
    exchangeCodeForSessionMock.mockResolvedValue({ error: { message: 'expired' } });

    const next = '/diagnostic?url=' + encodeURIComponent('https://tiktok.com/x');
    const request = new Request(
      `https://app.example.com/auth/callback?code=stale-code&next=${encodeURIComponent(next)}`
    );
    const response = await GET(request);

    const location = new URL(response.headers.get('location')!);
    expect(location.origin).toBe('https://app.example.com');
    expect(location.pathname).toBe('/diagnostic');
    expect(location.searchParams.get('authError')).toBe('expired');
    expect(location.searchParams.get('url')).toBe('https://tiktok.com/x');
  });
});
