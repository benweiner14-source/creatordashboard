import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Spinner } from '@/components/Spinner';

describe('Spinner', () => {
  it('renders its label with a status role', () => {
    render(<Spinner label="Analyzing…" />);
    expect(screen.getByRole('status')).toHaveTextContent('Analyzing…');
  });

  it('defaults to a white ring for use inside a solid-color button', () => {
    const { container } = render(<Spinner label="Analyzing…" />);
    expect(container.querySelector('[aria-hidden="true"]')).toHaveClass('border-white/40', 'border-t-white');
  });

  it('uses a dark accent ring when rendered directly on the page background', () => {
    const { container } = render(<Spinner label="Analyzing…" variant="onLight" />);
    expect(container.querySelector('[aria-hidden="true"]')).toHaveClass('border-[#e5e7eb]', 'border-t-[#7c3aed]');
  });
});
