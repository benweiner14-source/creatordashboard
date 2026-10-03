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

  // Live testing found the tooltip is a fixed w-64 (256px) box with no
  // viewport-edge handling, opened by tap on mobile — a term appearing
  // anywhere past roughly the first third of a text line could push it past
  // the right edge, causing real horizontal page overflow, not just a
  // clipped tooltip. Centering under the trigger and capping the width to
  // the viewport (minus gutters) keeps it on-screen regardless of where the
  // term falls in the surrounding text.
  it('centers the tooltip under the trigger and caps its width to the viewport', () => {
    const term = findGlossaryTermBySlug('hook-rate')!;
    render(<GlossaryChip term={term}>hook rate</GlossaryChip>);
    fireEvent.click(screen.getByRole('button', { name: 'hook rate' }));

    const tooltip = screen.getByRole('tooltip');
    expect(Array.from(tooltip.classList)).toEqual(
      expect.arrayContaining(['left-1/2', '-translate-x-1/2', 'max-w-[calc(100vw-2rem)]'])
    );
  });
});

describe('GlossaryText', () => {
  it('renders recognized terms as clickable glossary chips', () => {
    render(<GlossaryText text="Your hook rate was low this week." />);
    expect(screen.getByRole('button', { name: 'hook rate' })).toBeInTheDocument();
  });
});
