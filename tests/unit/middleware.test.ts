// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const getUserMock = vi.fn().mockResolvedValue({ data: { user: null } });
vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({
    auth: { getUser: getUserMock },
  })),
}));

import { middleware } from '@/middleware';

describe('middleware', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-placeholder-key';
    getUserMock.mockClear();
  });

  it('refreshes the session by calling getUser and returns a response', async () => {
    const request = new NextRequest('https://app.example.com/diagnostic');
    const response = await middleware(request);
    expect(getUserMock).toHaveBeenCalledTimes(1);
    expect(response).toBeInstanceOf(Response);
  });
});
