// tests/unit/app/api/home-route.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getUserMock = vi.fn();
const fromMock = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
  createSupabaseServiceRoleClient: vi.fn(() => ({ from: fromMock })),
}));

import { GET } from '@/app/api/home/route';

/**
 * Minimal chainable stand-in for the Supabase query builder. Every
 * intermediate call (`select`/`eq`/`order`/`limit`) returns the same object;
 * the terminal calls (`single`/`maybeSingle`) resolve to whatever result was
 * registered for that table.
 */
function stubTables(resultsByTable: Record<string, { data: unknown }>) {
  fromMock.mockImplementation((table: string) => {
    const result = resultsByTable[table] ?? { data: null };
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'order', 'limit']) {
      builder[method] = vi.fn(() => builder);
    }
    for (const method of ['single', 'maybeSingle']) {
      builder[method] = vi.fn(async () => result);
    }
    return builder;
  });
}

beforeEach(() => {
  getUserMock.mockReset();
  fromMock.mockReset();
});

describe('GET /api/home', () => {
  it('returns 401 when signed out', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'You must be signed in to view your dashboard.' });
    // The auth gate must short-circuit before any service-role query runs.
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('shapes every empty section as null for a brand-new signed-in user', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1', email: 'jordan@example.com' } } });
    stubTables({
      profiles: { data: null },
      diagnostics: { data: null },
      recap_cards: { data: null },
      weekly_digests: { data: null },
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      email: 'jordan@example.com',
      diagnostic: null,
      recap: null,
      ideas: { niche: null, digest: null },
    });
  });

  it('leaves ideas.digest null when a digest row exists but holds no ideas', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1', email: 'jordan@example.com' } } });
    stubTables({
      profiles: { data: { niche: 'home baking' } },
      diagnostics: { data: null },
      recap_cards: { data: null },
      weekly_digests: { data: { week_start: '2026-08-10', content_ideas: [] } },
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ideas).toEqual({ niche: 'home baking', digest: null });
  });

  it('summarizes the digest when this week has content ideas', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1', email: 'jordan@example.com' } } });
    stubTables({
      profiles: { data: { niche: 'home baking' } },
      diagnostics: { data: null },
      recap_cards: { data: null },
      weekly_digests: {
        data: {
          week_start: '2026-08-10',
          content_ideas: [{ workingTitle: 'Sourdough Speedrun' }, { workingTitle: 'Second Idea' }],
        },
      },
    });

    const response = await GET();
    const body = await response.json();

    expect(body.ideas).toEqual({
      niche: 'home baking',
      digest: { weekStart: '2026-08-10', ideaCount: 2, firstIdeaTitle: 'Sourdough Speedrun' },
    });
  });
});
