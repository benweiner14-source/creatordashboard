import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

let searchParams = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParams,
}));

import UnsubscribedPage from '@/app/digest/unsubscribed/page';

describe('UnsubscribedPage', () => {
  afterEach(() => {
    searchParams = new URLSearchParams();
  });

  it('shows a confirmation when status is ok', () => {
    searchParams = new URLSearchParams({ status: 'ok' });
    render(<UnsubscribedPage />);
    expect(screen.getByRole('heading', { name: /you're unsubscribed/i })).toBeInTheDocument();
  });

  it('shows an error message when status is invalid', () => {
    searchParams = new URLSearchParams({ status: 'invalid' });
    render(<UnsubscribedPage />);
    expect(screen.getByRole('heading', { name: /that link didn't work/i })).toBeInTheDocument();
  });
});
