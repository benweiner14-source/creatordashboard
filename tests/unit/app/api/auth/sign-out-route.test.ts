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

  it('returns 500 when Supabase reports a sign-out error', async () => {
    signOutMock.mockResolvedValue({ error: { message: 'session revoke failed' } });

    const response = await POST();
    const body = await response.json();

    // Reporting ok:true here would send the client to '/', which redirects a
    // still-signed-in visitor back to /home — a silent no-op sign-out.
    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "We couldn't sign you out. Please try again." });
  });
});
