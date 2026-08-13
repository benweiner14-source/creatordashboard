// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const signInWithOtpMock = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(() => ({
    auth: { signInWithOtp: signInWithOtpMock },
  })),
}));

import { POST } from '@/app/api/auth/magic-link/route';

function makeRequest(body: unknown) {
  return new Request('https://app.example.com/api/auth/magic-link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/magic-link', () => {
  beforeEach(() => {
    signInWithOtpMock.mockReset();
  });

  it('calls signInWithOtp with emailRedirectTo nested under options, and returns 200 on success', async () => {
    signInWithOtpMock.mockResolvedValue({ error: null });

    const response = await POST(
      makeRequest({ email: 'creator@example.com', redirectPath: '/diagnostic?url=https%3A%2F%2Ftiktok.com%2Fx' })
    );
    const body = await response.json();

    // This is exactly the nested shape (`{ email, options: { emailRedirectTo } }`) that an
    // earlier fix round found was required by the real Supabase client but was invisible to
    // unit tests that only assert the mock's own contract — regression coverage for that bug.
    expect(signInWithOtpMock).toHaveBeenCalledWith({
      email: 'creator@example.com',
      options: {
        emailRedirectTo:
          'https://app.example.com/auth/callback?next=' +
          encodeURIComponent('/diagnostic?url=https%3A%2F%2Ftiktok.com%2Fx'),
      },
    });
    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true });
  });

  it('returns 400 without calling Supabase for an invalid email', async () => {
    const response = await POST(makeRequest({ email: 'not-an-email', redirectPath: '/diagnostic' }));
    const body = await response.json();

    expect(signInWithOtpMock).not.toHaveBeenCalled();
    expect(response.status).toBe(400);
    expect(body).toEqual({ error: "That doesn't look like a valid email address. Double-check it and try again." });
  });

  it('returns the rate-limit message and status when Supabase reports a 429', async () => {
    signInWithOtpMock.mockResolvedValue({ error: { message: 'rate limited', status: 429 } });

    const response = await POST(makeRequest({ email: 'creator@example.com', redirectPath: '/diagnostic' }));
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body).toEqual({ error: "You've requested a few sign-in links in a row. Wait a minute and try again." });
  });

  it('returns 400 when no email is provided at all', async () => {
    const response = await POST(makeRequest({}));
    expect(response.status).toBe(400);
    expect(signInWithOtpMock).not.toHaveBeenCalled();
  });
});
