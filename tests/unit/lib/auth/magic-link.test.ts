import { describe, it, expect, vi, type Mock } from 'vitest';
import { requestMagicLink } from '@/lib/auth/magic-link';
import { createInMemoryRateLimitStore } from '../../../fakes/rate-limit-store.fake';

interface MakeDepsOverrides {
  signInWithOtp?: Mock;
  rateLimitStore?: Parameters<typeof requestMagicLink>[0]['rateLimitStore'];
  ipSalt?: string;
}

function makeDeps(overrides: MakeDepsOverrides = {}) {
  return {
    signInWithOtp: vi.fn().mockResolvedValue({ error: null }),
    rateLimitStore: createInMemoryRateLimitStore(),
    ipSalt: 'test-salt',
    ...overrides,
  };
}

function makeParams(overrides: Partial<Parameters<typeof requestMagicLink>[1]> = {}) {
  return {
    email: 'creator@example.com',
    redirectPath: '/diagnostic',
    origin: 'https://app.example.com',
    ip: '203.0.113.1',
    ...overrides,
  };
}

describe('requestMagicLink', () => {
  it('rejects an invalid email format before calling Supabase or the rate limiter', async () => {
    const deps = makeDeps();
    const result = await requestMagicLink(deps, makeParams({ email: 'not-an-email' }));
    expect(result.status).toBe(400);
    expect(deps.signInWithOtp).not.toHaveBeenCalled();
  });

  it('sends a magic link with the redirect path embedded in emailRedirectTo', async () => {
    const deps = makeDeps();
    const redirectPath = '/diagnostic?url=https%3A%2F%2Ftiktok.com%2Fx';
    const result = await requestMagicLink(deps, makeParams({ redirectPath }));
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true });
    expect(deps.signInWithOtp).toHaveBeenCalledWith({
      email: 'creator@example.com',
      emailRedirectTo: `https://app.example.com/auth/callback?next=${encodeURIComponent(redirectPath)}`,
    });
  });

  it('returns a rate-limit-specific message when Supabase reports a 429', async () => {
    const deps = makeDeps({ signInWithOtp: vi.fn().mockResolvedValue({ error: { message: 'rate limited', status: 429 } }) });
    const result = await requestMagicLink(deps, makeParams());
    expect(result.status).toBe(429);
    expect(result.body).toEqual({ error: "You've requested a few sign-in links in a row. Wait a minute and try again." });
  });

  it('falls back to /diagnostic when redirectPath is an absolute URL (open-redirect guard)', async () => {
    const deps = makeDeps();
    const result = await requestMagicLink(deps, makeParams({ redirectPath: 'https://evil.example' }));
    expect(result.status).toBe(200);
    expect(deps.signInWithOtp).toHaveBeenCalledWith({
      email: 'creator@example.com',
      emailRedirectTo: `https://app.example.com/auth/callback?next=${encodeURIComponent('/diagnostic')}`,
    });
  });

  it('returns a generic server error for other Supabase failures, without leaking account existence', async () => {
    const deps = makeDeps({ signInWithOtp: vi.fn().mockResolvedValue({ error: { message: 'boom' } }) });
    const result = await requestMagicLink(deps, makeParams());
    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: "We couldn't reach the server. Check your connection and try again." });
  });

  describe('rate limiting', () => {
    it('denies a fourth request for the same email within the window, without calling Supabase', async () => {
      const deps = makeDeps();
      for (let i = 0; i < 3; i++) {
        await requestMagicLink(deps, makeParams());
      }
      deps.signInWithOtp.mockClear();

      const result = await requestMagicLink(deps, makeParams());
      expect(result.status).toBe(429);
      expect(deps.signInWithOtp).not.toHaveBeenCalled();
    });

    it('rate-limits distinct emails independently of each other', async () => {
      const deps = makeDeps();
      for (let i = 0; i < 3; i++) {
        await requestMagicLink(deps, makeParams({ email: 'first@example.com', ip: '203.0.113.1' }));
      }
      const result = await requestMagicLink(deps, makeParams({ email: 'second@example.com', ip: '203.0.113.2' }));
      expect(result.status).toBe(200);
    });

    it('denies an 11th distinct email from the same IP within the window (ip_limit)', async () => {
      const deps = makeDeps();
      for (let i = 0; i < 10; i++) {
        await requestMagicLink(deps, makeParams({ email: `user${i}@example.com`, ip: '203.0.113.1' }));
      }
      deps.signInWithOtp.mockClear();

      const result = await requestMagicLink(deps, makeParams({ email: 'user10@example.com', ip: '203.0.113.1' }));
      expect(result.status).toBe(429);
      expect(deps.signInWithOtp).not.toHaveBeenCalled();
    });

    it('releases the rate-limit event when signInWithOtp fails, so the slot is not consumed', async () => {
      const store = createInMemoryRateLimitStore();
      const failingDeps = makeDeps({
        rateLimitStore: store,
        signInWithOtp: vi.fn().mockResolvedValue({ error: { message: 'boom' } }),
      });
      const first = await requestMagicLink(failingDeps, makeParams());
      expect(first.status).toBe(500);

      const succeedingDeps = makeDeps({ rateLimitStore: store });
      const second = await requestMagicLink(succeedingDeps, makeParams());
      expect(second.status).toBe(200);
    });

    it('releases the rate-limit event when signInWithOtp throws, so the slot is not consumed', async () => {
      const store = createInMemoryRateLimitStore();
      const throwingDeps = makeDeps({
        rateLimitStore: store,
        signInWithOtp: vi.fn().mockRejectedValue(new Error('network error')),
      });
      await expect(requestMagicLink(throwingDeps, makeParams())).rejects.toThrow('network error');

      const succeedingDeps = makeDeps({ rateLimitStore: store });
      const second = await requestMagicLink(succeedingDeps, makeParams());
      expect(second.status).toBe(200);
    });
  });
});
