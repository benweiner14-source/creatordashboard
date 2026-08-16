import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ScoreRing } from '@/components/ScoreRing';

const CIRCUMFERENCE = 2 * Math.PI * 18;

describe('ScoreRing', () => {
  it('renders a full offset at 0', () => {
    const { getByTestId } = render(<ScoreRing value={0} label="Hook" color="#4338ca" />);
    expect(Number(getByTestId('score-ring-arc').getAttribute('stroke-dashoffset'))).toBeCloseTo(CIRCUMFERENCE, 5);
  });

  it('renders zero offset at 100', () => {
    const { getByTestId } = render(<ScoreRing value={100} label="Hook" color="#4338ca" />);
    expect(Number(getByTestId('score-ring-arc').getAttribute('stroke-dashoffset'))).toBeCloseTo(0, 5);
  });

  it('renders half offset at 50', () => {
    const { getByTestId } = render(<ScoreRing value={50} label="Hook" color="#4338ca" />);
    expect(Number(getByTestId('score-ring-arc').getAttribute('stroke-dashoffset'))).toBeCloseTo(CIRCUMFERENCE / 2, 5);
  });

  it('clamps out-of-range values into 0-100', () => {
    const { getByTestId } = render(<ScoreRing value={150} label="Hook" color="#4338ca" />);
    expect(Number(getByTestId('score-ring-arc').getAttribute('stroke-dashoffset'))).toBeCloseTo(0, 5);
  });

  it('renders the rounded score and label as visible text', () => {
    const { getByText } = render(<ScoreRing value={82.4} label="Hook" color="#4338ca" />);
    expect(getByText('82')).toBeInTheDocument();
    expect(getByText('Hook')).toBeInTheDocument();
  });
});
