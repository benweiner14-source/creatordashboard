import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Banner } from '@/components/Banner';

describe('Banner', () => {
  it('renders the label and body content', () => {
    render(
      <Banner variant="caution" label="Low confidence">
        This score is directional, not precise.
      </Banner>
    );
    expect(screen.getByText('Low confidence')).toBeInTheDocument();
    expect(screen.getByText('This score is directional, not precise.')).toBeInTheDocument();
  });

  it('renders a decorative grain overlay only for the promo variant', () => {
    const { container: promo } = render(
      <Banner variant="promo" label="Locked">
        Upgrade to unlock this analysis.
      </Banner>
    );
    expect(promo.querySelector('svg[aria-hidden="true"]')).toBeInTheDocument();

    const { container: critical } = render(
      <Banner variant="critical" label="Analysis failed">
        Couldn&apos;t analyze this video.
      </Banner>
    );
    expect(critical.querySelector('svg')).not.toBeInTheDocument();
  });

  it('forwards a role to the outer element when given', () => {
    render(
      <Banner variant="critical" label="Analysis failed" role="alert">
        Couldn&apos;t analyze this video.
      </Banner>
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders every variant without throwing', () => {
    const variants = ['caution', 'info', 'cached', 'positive', 'critical', 'promo'] as const;
    for (const variant of variants) {
      const { unmount } = render(
        <Banner variant={variant} label={variant}>
          body
        </Banner>
      );
      unmount();
    }
  });
});
