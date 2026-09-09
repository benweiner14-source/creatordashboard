// tests/unit/lib/glossary.test.ts
import { describe, it, expect } from 'vitest';
import { getGlossaryTerms, findGlossaryTermBySlug, linkGlossaryTerms } from '@/lib/glossary';

describe('getGlossaryTerms', () => {
  it('returns the seeded set of glossary terms', () => {
    const terms = getGlossaryTerms();
    expect(terms.length).toBeGreaterThanOrEqual(9);
    expect(terms.map((t) => t.slug)).toContain('hook-rate');
  });
});

describe('findGlossaryTermBySlug', () => {
  it('finds a term by its slug', () => {
    expect(findGlossaryTermBySlug('retention')?.term).toBe('Retention');
  });

  it('returns undefined for an unknown slug', () => {
    expect(findGlossaryTermBySlug('not-a-real-term')).toBeUndefined();
  });

  it('finds the LinkedIn strategy terms added for the LinkedIn Content Strategy feature', () => {
    expect(findGlossaryTermBySlug('content-pillars')?.term).toBe('Content Pillars');
    expect(findGlossaryTermBySlug('posting-cadence')?.term).toBe('Posting Cadence');
    expect(findGlossaryTermBySlug('positioning')?.term).toBe('Positioning');
  });
});

describe('linkGlossaryTerms', () => {
  it('splits text into text and term segments', () => {
    const segments = linkGlossaryTerms('Your hook rate was low this week.');
    const termSegment = segments.find((s) => s.type === 'term');
    expect(termSegment).toBeDefined();
    expect(termSegment?.value.toLowerCase()).toBe('hook rate');
    if (termSegment?.type === 'term') {
      expect(termSegment.term.slug).toBe('hook-rate');
    }
  });

  it('returns a single text segment when no terms match', () => {
    const segments = linkGlossaryTerms('Nothing jargon-y here.');
    expect(segments).toEqual([{ type: 'text', value: 'Nothing jargon-y here.' }]);
  });
});
