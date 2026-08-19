import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HomeCard } from '@/components/HomeCard';

describe('HomeCard', () => {
  it('renders its children', () => {
    render(
      <HomeCard>
        <p>Card content</p>
      </HomeCard>
    );
    expect(screen.getByText('Card content')).toBeInTheDocument();
  });

  it('applies the default white-card styling by default', () => {
    const { container } = render(<HomeCard>content</HomeCard>);
    expect(container.firstChild).toHaveClass('bg-white');
  });

  it('applies the gradient cta styling when variant is "cta"', () => {
    const { container } = render(<HomeCard variant="cta">content</HomeCard>);
    expect((container.firstChild as HTMLElement)?.className).toContain('linear-gradient');
    expect(container.firstChild).not.toHaveClass('bg-white');
  });

  it('sets aria-labelledby when provided', () => {
    render(
      <HomeCard ariaLabelledBy="my-heading">
        <h3 id="my-heading">Heading</h3>
      </HomeCard>
    );
    expect(screen.getByRole('article')).toHaveAttribute('aria-labelledby', 'my-heading');
  });
});
