import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GlossaryChip, GlossaryText } from '@/components/GlossaryChip';
import { findGlossaryTermBySlug } from '@/lib/glossary';

describe('GlossaryChip', () => {
  it('shows the definition tooltip when clicked', () => {
    const term = findGlossaryTermBySlug('hook-rate')!;
    render(<GlossaryChip term={term}>hook rate</GlossaryChip>);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'hook rate' }));
    expect(screen.getByRole('tooltip')).toHaveTextContent(term.definition);
  });
});

describe('GlossaryText', () => {
  it('renders recognized terms as clickable glossary chips', () => {
    render(<GlossaryText text="Your hook rate was low this week." />);
    expect(screen.getByRole('button', { name: 'hook rate' })).toBeInTheDocument();
  });
});
