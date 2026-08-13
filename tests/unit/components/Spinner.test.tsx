import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Spinner } from '@/components/Spinner';

describe('Spinner', () => {
  it('renders its label with a status role', () => {
    render(<Spinner label="Analyzing…" />);
    expect(screen.getByRole('status')).toHaveTextContent('Analyzing…');
  });
});
