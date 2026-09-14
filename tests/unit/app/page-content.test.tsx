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
    expect(screen.getByRole('link', { name: /get your monthly recap card/i })).toHaveAttribute('href', '/recap');
  });

  it('links to the weekly ideas tool', async () => {
    await renderSignedOut();
    expect(screen.getByRole('link', { name: /get weekly content ideas/i })).toHaveAttribute('href', '/ideas');
  });

  it('links to the strategy breakdown tool', async () => {
    await renderSignedOut();
    expect(screen.getByRole('link', { name: /break down a channel you admire/i })).toHaveAttribute('href', '/strategy');
  });

  it('shows the value-proposition headline', async () => {
    await renderSignedOut();
    expect(
      screen.getByRole('heading', { name: /everything a creator needs to grow, in one dashboard/i })
    ).toBeInTheDocument();
  });

  it('links to the competitor watchlist tool', async () => {
    await renderSignedOut();
    expect(screen.getByRole('link', { name: /track your competitors/i })).toHaveAttribute('href', '/watchlist');
  });
});
