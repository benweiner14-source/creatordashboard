// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

const getUserMock = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(() => ({
    auth: { getUser: getUserMock },
  })),
}));

import { GET } from '@/app/api/session/route';

describe('GET /api/session', () => {
  it('returns the signed-in email', async () => {
    getUserMock.mockResolvedValue({ data: { user: { email: 'jordan@example.com' } } });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ email: 'jordan@example.com' });
  });

  it('returns 401 when signed out', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'You must be signed in.' });
  });
});
