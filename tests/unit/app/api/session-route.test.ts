// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getUserMock = vi.fn();
const fromMock = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(() => ({
    auth: { getUser: getUserMock },
  })),
  createSupabaseServiceRoleClient: vi.fn(() => ({ from: fromMock })),
}));

import { GET } from '@/app/api/session/route';

/**
 * Stubs the `profiles` service-role query chain the route uses to check and
 * clear `scheduled_deletion_at`. Returns the `update`/`eq` mocks so tests can
 * assert whether (and how) the deletion was cleared.
 */
function mockProfileQuery(row: { scheduled_deletion_at: string | null } | null) {
  const single = vi.fn().mockResolvedValue({ data: row });
  const selectEq = vi.fn().mockReturnValue({ single });
  const select = vi.fn().mockReturnValue({ eq: selectEq });
  const updateEq = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn().mockReturnValue({ eq: updateEq });
  fromMock.mockReturnValue({ select, update });
  return { select, update, updateEq };
}

beforeEach(() => {
  getUserMock.mockReset();
  fromMock.mockReset();
});

describe('GET /api/session', () => {
  it('returns the signed-in email', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1', email: 'jordan@example.com' } } });
    mockProfileQuery({ scheduled_deletion_at: null });

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

  it('returns 401 rather than an empty email when the user has no email address', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1', email: null } } });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'You must be signed in.' });
  });

  it('returns just the email when there is no pending deletion', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1', email: 'creator@example.com' } } });
    mockProfileQuery({ scheduled_deletion_at: null });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ email: 'creator@example.com' });
  });

  it('clears a pending deletion and flags justCancelledDeletion when one exists', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1', email: 'creator@example.com' } } });
    const { update, updateEq } = mockProfileQuery({ scheduled_deletion_at: '2026-10-14T00:00:00Z' });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ email: 'creator@example.com', justCancelledDeletion: true });
    expect(update).toHaveBeenCalledWith({ scheduled_deletion_at: null });
    expect(updateEq).toHaveBeenCalledWith('id', 'user-1');
  });
});
