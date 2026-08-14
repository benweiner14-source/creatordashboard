import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import HomePage from '@/app/page';

describe('HomePage', () => {
  it('links to the diagnostic page', () => {
    render(<HomePage />);
    const link = screen.getByRole('link', { name: /run a free diagnostic/i });
    expect(link).toHaveAttribute('href', '/diagnostic');
  });

  it('links to the recap page', () => {
    render(<HomePage />);
    expect(screen.getByRole('link', { name: /recap card/i })).toHaveAttribute('href', '/recap');
  });

  it('links to the content ideas page', () => {
    render(<HomePage />);
    expect(screen.getByRole('link', { name: /content ideas/i })).toHaveAttribute('href', '/ideas');
  });
});
