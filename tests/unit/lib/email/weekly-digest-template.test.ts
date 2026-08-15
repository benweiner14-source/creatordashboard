import { describe, it, expect } from 'vitest';
import { renderWeeklyDigestEmail } from '@/lib/email/weekly-digest-template';
import type { ContentIdea } from '@/lib/integrations/claude-ideas';

const IDEA: ContentIdea = {
  workingTitle: 'Sourdough Speedrun',
  pitch: 'Bake a loaf in under 2 hours on camera',
  medium: 'reel',
  format: 'Speed Recap',
  whyItsHotNow: 'Sourdough resurgence trending this week',
  sourceUrl: 'https://example.com/a',
  whyItRanksHere: 'High reach from trend-jacking',
  kpiSignals: ['reach'],
  reelDetails: { suggestedLengthSeconds: 60, style: 'talking-head' },
  carouselDetails: null,
};

describe('renderWeeklyDigestEmail', () => {
  it('includes the week start in the subject', () => {
    const { subject } = renderWeeklyDigestEmail({
      niche: 'home baking',
      weekStart: '2026-08-17',
      ideas: [IDEA],
      unsubscribeUrl: 'https://example.com/unsub',
    });
    expect(subject).toBe('Your content ideas for the week of 2026-08-17');
  });

  it('renders every idea and the unsubscribe link', () => {
    const { html } = renderWeeklyDigestEmail({
      niche: 'home baking',
      weekStart: '2026-08-17',
      ideas: [IDEA],
      unsubscribeUrl: 'https://example.com/unsub?profile=p1&token=abc',
    });
    expect(html).toContain('Sourdough Speedrun');
    expect(html).toContain('Bake a loaf in under 2 hours on camera');
    expect(html).toContain('Sourdough resurgence trending this week');
    expect(html).toContain('https://example.com/unsub?profile=p1&amp;token=abc');
  });

  it('escapes HTML-unsafe characters in idea content', () => {
    const unsafeIdea: ContentIdea = { ...IDEA, workingTitle: '<script>alert(1)</script>' };
    const { html } = renderWeeklyDigestEmail({
      niche: 'home baking',
      weekStart: '2026-08-17',
      ideas: [unsafeIdea],
      unsubscribeUrl: 'https://example.com/unsub',
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('renders a niche-only shell with no idea blocks when given an empty ideas array', () => {
    const { html } = renderWeeklyDigestEmail({
      niche: 'home baking',
      weekStart: '2026-08-17',
      ideas: [],
      unsubscribeUrl: 'https://example.com/unsub',
    });
    expect(html).toContain('home baking');
    expect(html).toContain('Unsubscribe');
  });
});
