import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === 'sb-test' ? { value: 'abc' } : undefined),
    set: vi.fn(),
  }),
}));

describe('Supabase client helpers', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-placeholder-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-placeholder-key';
  });

  it('builds a browser client without a live connection', async () => {
    const { createSupabaseBrowserClient } = await import('@/lib/supabase/browser');
    const client = createSupabaseBrowserClient();
    expect(typeof client.from).toBe('function');
  });

  it('builds a server client without a live connection', async () => {
    const { createSupabaseServerClient } = await import('@/lib/supabase/server');
    const client = await createSupabaseServerClient();
    expect(typeof client.from).toBe('function');
  });

  it('builds a service-role client without a live connection', async () => {
    const { createSupabaseServiceRoleClient } = await import('@/lib/supabase/server');
    const client = createSupabaseServiceRoleClient();
    expect(typeof client.from).toBe('function');
  });
});
