// tests/unit/app/page.test.tsx
// @vitest-environment node
//
// Redirect behavior only. The rendered marketing content is asserted in
// page-content.test.tsx, which needs the jsdom environment — Vitest sets the
// environment per file, so the two concerns live in two files.
import { describe, it, expect, vi, afterEach } from 'vitest';

// vi.mock factories run before this file's top-level const declarations
// (vi.mock calls are hoisted above them), so the mock fns referenced
// directly inside those factories must themselves be created via
// vi.hoisted() to exist in time — a plain `const x = vi.fn()` here throws
// "Cannot access before initialization" once the mocked modules are
// actually imported by app/page.tsx.
const { getUserMock, redirectMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  redirectMock: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(() => ({
    auth: { getUser: getUserMock },
  })),
}));

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}));

import MarketingPage from '@/app/page';

describe('MarketingPage redirect behavior', () => {
  afterEach(() => {
    getUserMock.mockClear();
    redirectMock.mockClear();
    vi.unstubAllEnvs();
  });

  // Both of these model a configured deployment (Vercel always sets these
  // in production) — stubbed explicitly rather than relying on whatever
  // happens to be in the ambient environment, since CI sets neither var
  // at all and a test that only passed by accident of a local .env.local
  // would silently fail there.
  it('redirects to /home when the visitor is signed in', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
    getUserMock.mockResolvedValue({ data: { user: { id: 'profile-1' } } });
    redirectMock.mockImplementation(() => {
      throw new Error('NEXT_REDIRECT');
    });

    await expect(MarketingPage()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirectMock).toHaveBeenCalledWith('/home');
  });

  it('does not redirect when the visitor is signed out', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
    getUserMock.mockResolvedValue({ data: { user: null } });

    const element = await MarketingPage();

    expect(redirectMock).not.toHaveBeenCalled();
    expect(element).toBeTruthy();
  });

  // The regression this guards against: before this test existed, /
  // called createSupabaseServerClient() unconditionally, which throws
  // when these vars are unset (the actual state of CI, and of any
  // deployment before a real Supabase project is connected) — crashing
  // the one page in the app that's supposed to always be browsable.
  it('renders without touching Supabase when the env vars are not configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', undefined);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', undefined);

    const element = await MarketingPage();

    expect(getUserMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
    expect(element).toBeTruthy();
  });
});
