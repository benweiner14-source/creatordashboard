import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlatformBadge } from '@/components/PlatformBadge';

describe('PlatformBadge', () => {
  it('renders the YouTube badge with its brand color and accessible label', () => {
    render(<PlatformBadge platform="youtube" />);
    expect(screen.getByRole('img', { name: 'YouTube' }).className).toContain('bg-[#e5342a]');
  });

  it('renders the TikTok badge with its brand color and accessible label', () => {
    render(<PlatformBadge platform="tiktok" />);
    expect(screen.getByRole('img', { name: 'TikTok' }).className).toContain('bg-[#121212]');
  });

  it('renders the Instagram badge with a gradient background and accessible label', () => {
    render(<PlatformBadge platform="instagram" />);
    expect(screen.getByRole('img', { name: 'Instagram' }).className).toContain('linear-gradient');
  });
});
