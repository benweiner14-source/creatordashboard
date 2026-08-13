// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

const fakeRow = {
  id: 'recap-1',
  profile_id: 'profile-1',
  month: '2026-08-01',
  platform_data: {
    youtube: { views: 82000, likes: 5100, comments: 300, postCount: 8 },
    tiktok: { views: 45000, likes: 3100, comments: 130, postCount: 6 },
  },
  totals: { views: 127000, likes: 8200, comments: 430, postCount: 14 },
  top_post: {
    platform: 'tiktok',
    captionOrTitle: 'Wait for it — the one trick that finally made this work',
    viewCount: 52000,
    permalink: 'https://tiktok.com/@creator/video/1',
  },
  warnings: [],
  generated_at: '2026-08-13T00:00:00.000Z',
};

let nextRow: { data: unknown; error: unknown } = { data: fakeRow, error: null };

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServiceRoleClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => nextRow,
        }),
      }),
    }),
  }),
}));

import { GET } from '@/app/recap/[id]/image/route';

describe('GET /recap/[id]/image', () => {
  it('renders a real PNG for a stored recap card', async () => {
    nextRow = { data: fakeRow, error: null };

    const response = await GET(new Request('http://localhost/recap/recap-1/image'), {
      params: Promise.resolve({ id: 'recap-1' }),
    });

    expect(response.status).toBe(200);
    const bytes = new Uint8Array(await response.arrayBuffer());
    // A real rendered card, not an error page or an empty body.
    expect(bytes.byteLength).toBeGreaterThan(1000);
    // PNG magic number.
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  }, 30_000);

  it('sets a long-lived immutable Cache-Control header (the row never changes)', async () => {
    nextRow = { data: fakeRow, error: null };

    const response = await GET(new Request('http://localhost/recap/recap-1/image'), {
      params: Promise.resolve({ id: 'recap-1' }),
    });

    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  }, 30_000);

  it('404s when there is no such recap card', async () => {
    nextRow = { data: null, error: { message: 'not found' } };

    const response = await GET(new Request('http://localhost/recap/nope/image'), {
      params: Promise.resolve({ id: 'nope' }),
    });

    expect(response.status).toBe(404);
  });
});
