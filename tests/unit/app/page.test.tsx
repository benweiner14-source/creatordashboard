import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import HomePage from '@/app/page';

describe('HomePage', () => {
  it('links to the diagnostic page', () => {
    render(<HomePage />);
    const link = screen.getByRole('link', { name: /run a free diagnostic/i });
    expect(link).toHaveAttribute('href', '/diagnostic');
  });
});
