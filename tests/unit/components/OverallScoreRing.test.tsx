import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OverallScoreRing } from '@/components/OverallScoreRing';

// jsdom has no matchMedia; stub prefers-reduced-motion: reduce so the ring
// lands on its final value immediately instead of animating over real time —
// these tests assert the resting state, not the count-up itself.
function stubReducedMotion() {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
  );
}

describe('OverallScoreRing', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the score, band word, and an accessible group label', () => {
    stubReducedMotion();
    render(<OverallScoreRing value={55} />);
    expect(screen.getByRole('group', { name: 'Overall score 55 out of 100, band Moderate' })).toBeInTheDocument();
    expect(screen.getByTestId('overall-score-number')).toHaveTextContent('55');
    expect(screen.getByText('Moderate')).toBeInTheDocument();
    expect(screen.getByText((_, el) => el?.textContent === '55 / 100')).toBeInTheDocument();
  });

  it('labels scores below 40 as Building', () => {
    stubReducedMotion();
    render(<OverallScoreRing value={28} />);
    expect(screen.getByText('Building')).toBeInTheDocument();
  });

  it('labels scores 70 and above as Strong', () => {
    stubReducedMotion();
    render(<OverallScoreRing value={82} />);
    expect(screen.getByText('Strong')).toBeInTheDocument();
  });

  it('clamps and rounds out-of-range values', () => {
    stubReducedMotion();
    render(<OverallScoreRing value={150} />);
    expect(screen.getByTestId('overall-score-number')).toHaveTextContent('100');
  });
});
