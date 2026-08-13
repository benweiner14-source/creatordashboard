// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const getUserMock = vi.fn().mockResolvedValue({ data: { user: null } });
const createServerClientMock = vi.fn((..._args: unknown[]) => ({
  auth: { getUser: getUserMock },
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
});
