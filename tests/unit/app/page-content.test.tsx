// tests/unit/app/page-content.test.tsx
// @vitest-environment jsdom
//
// The rendered marketing content for a signed-out visitor. `/` is an async
// server component, so we await it first and render the resolved JSX. Its
// redirect behavior is covered in page.test.tsx, which runs in the node
// environment (Vitest picks the environment per file, not per describe).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

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

describe('MarketingPage content (signed out)', () => {
  afterEach(() => {
    getUserMock.mockClear();
    redirectMock.mockClear();
  });

  async function renderSignedOut() {
    getUserMock.mockResolvedValue({ data: { user: null } });
    render(await MarketingPage());
  }

  it('links to the monthly recap tool', async () => {
    await renderSignedOut();
    expect(screen.getByRole('link', { name: /track your gta 6 channel's growth every month/i })).toHaveAttribute(
      'href',
      '/recap'
    );
  });

  it('links to the weekly ideas tool', async () => {
    await renderSignedOut();
    expect(screen.getByRole('link', { name: /get this week's gta 6 content ideas/i })).toHaveAttribute('href', '/ideas');
  });

  it('links to the strategy breakdown tool', async () => {
    await renderSignedOut();
    expect(screen.getByRole('link', { name: /break down any gta 6 creator's strategy/i })).toHaveAttribute(
      'href',
      '/strategy'
    );
  });

  it('shows the value-proposition headline', async () => {
    await renderSignedOut();
    expect(
      screen.getByRole('heading', { name: /gta 6 is about to be the biggest launch gaming has ever seen/i })
    ).toBeInTheDocument();
  });

  it('links to the competitor watchlist tool', async () => {
    await renderSignedOut();
    expect(screen.getByRole('link', { name: /see who's already ahead — track gta 6 creators/i })).toHaveAttribute(
      'href',
      '/watchlist'
    );
  });

  it('links to the GTA 6 War Room', async () => {
    await renderSignedOut();
    expect(screen.getByRole('link', { name: /see what's trending in gta 6 right now/i })).toHaveAttribute('href', '/warroom');
  });
});
