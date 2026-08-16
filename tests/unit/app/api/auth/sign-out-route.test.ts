// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

const signOutMock = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(() => ({
    auth: { signOut: signOutMock },
  })),
}));

import { POST } from '@/app/api/auth/sign-out/route';

describe('POST /api/auth/sign-out', () => {
  it('signs out and returns ok', async () => {
    signOutMock.mockResolvedValue({ error: null });

    const response = await POST();
    const body = await response.json();

    expect(signOutMock).toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true });
  });
});
