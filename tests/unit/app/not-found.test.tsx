// tests/unit/app/not-found.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// AppNav makes its own fetch('/api/session') call on mount; not relevant to
// this page's own content, and its behavior is covered by its own suite.
vi.mock('@/components/AppNav', () => ({
  AppNav: () => null,
}));

import NotFound from '@/app/not-found';

describe('NotFound', () => {
  it('shows a branded message, not the generic Next.js default', () => {
    render(<NotFound />);
    expect(screen.getByRole('heading')).toHaveTextContent(/page/i);
    expect(screen.queryByText(/this page could not be found/i)).not.toBeInTheDocument();
  });

  it('links back into the app instead of being a dead end', () => {
    render(<NotFound />);
    expect(screen.getByRole('link', { name: /home/i })).toHaveAttribute('href', '/');
  });
});
