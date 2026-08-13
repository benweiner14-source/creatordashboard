import { describe, it, expect, vi } from 'vitest';
import { requestMagicLink } from '@/lib/auth/magic-link';

describe('requestMagicLink', () => {
  it('rejects an invalid email format before calling Supabase', async () => {
    const signInWithOtp = vi.fn();
    const result = await requestMagicLink(
      { signInWithOtp },
      { email: 'not-an-email', redirectPath: '/diagnostic', origin: 'https://app.example.com' }
    );
    expect(result.status).toBe(400);
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it('sends a magic link with the redirect path embedded in emailRedirectTo', async () => {
    const signInWithOtp = vi.fn().mockResolvedValue({ error: null });
    const redirectPath = '/diagnostic?url=https%3A%2F%2Ftiktok.com%2Fx';
    const result = await requestMagicLink(
      { signInWithOtp },
      { email: 'creator@example.com', redirectPath, origin: 'https://app.example.com' }
    );
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true });
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: 'creator@example.com',
      emailRedirectTo: `https://app.example.com/auth/callback?next=${encodeURIComponent(redirectPath)}`,
    });
  });

  it('returns a rate-limit-specific message when Supabase reports a 429', async () => {
    const signInWithOtp = vi.fn().mockResolvedValue({ error: { message: 'rate limited', status: 429 } });
    const result = await requestMagicLink(
      { signInWithOtp },
      { email: 'creator@example.com', redirectPath: '/diagnostic', origin: 'https://app.example.com' }
    );
    expect(result.status).toBe(429);
    expect(result.body).toEqual({ error: "You've requested a few sign-in links in a row. Wait a minute and try again." });
  });

  it('returns a generic server error for other Supabase failures, without leaking account existence', async () => {
    const signInWithOtp = vi.fn().mockResolvedValue({ error: { message: 'boom' } });
    const result = await requestMagicLink(
      { signInWithOtp },
      { email: 'creator@example.com', redirectPath: '/diagnostic', origin: 'https://app.example.com' }
    );
    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: "We couldn't reach the server. Check your connection and try again." });
  });
});
