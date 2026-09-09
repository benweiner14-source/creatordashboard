import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/components/AppNav', () => ({ AppNav: () => null }));

import LinkedInPage from '@/app/linkedin/page';

function jsonResponse(status: number, body: unknown) {
  return { status, ok: status < 400, json: async () => body };
}

describe('LinkedInPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows a sign-in prompt when bootstrap returns 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, { error: 'nope' })));
    render(<LinkedInPage />);
    await waitFor(() => expect(screen.getByLabelText(/email/i)).toBeInTheDocument());
  });

  it('shows an upgrade prompt when bootstrap returns 402', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(402, { error: 'nope' })));
    render(<LinkedInPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: /upgrade/i })).toBeInTheDocument());
  });

  it('shows the onboarding chip pickers when there is no strategy yet', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, latest: null, history: [] })));
    render(<LinkedInPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Gaming & esports' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Land brand or product partnerships' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /build my strategy/i })).toBeDisabled();
  });

  it('reveals a custom text box when "Something else" is picked for niche', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, latest: null, history: [] })));
    render(<LinkedInPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Gaming & esports' })).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole('button', { name: 'Something else' })[0]);
    expect(screen.getByLabelText(/your content niche/i)).toBeInTheDocument();
  });

  it('submits the chosen niche and goal and shows the resulting strategy', async () => {
    const fetchMock = vi.fn((url: string, options?: RequestInit) => {
      if (url === '/api/linkedin/strategy' && !options) {
        return Promise.resolve(jsonResponse(200, { ok: true, latest: null, history: [] }));
      }
      if (url === '/api/linkedin/strategy' && options?.method === 'POST') {
        return Promise.resolve(
          jsonResponse(200, {
            strategy: {
              id: 'strategy-1',
              niche: 'Gaming & esports',
              targetGoal: 'Land brand or product partnerships',
              contentPillars: ['Industry commentary'],
              postingCadenceRecommendation: 'Aim for 2 posts a week.',
              positioningNotes: 'Strong positioning as a rising voice in gaming will help you stand out.',
              headline: 'Lead with gaming industry insight',
              createdAt: '2026-09-09T00:00:00Z',
            },
          })
        );
      }
      if (url === '/api/linkedin/ideas') {
        return Promise.resolve(jsonResponse(200, { ideas: { postIdeas: [] } }));
      }
      if (url === '/api/linkedin/audit') {
        return Promise.resolve(jsonResponse(200, { ok: true, history: [] }));
      }
      return Promise.resolve(jsonResponse(404, {}));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<LinkedInPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Gaming & esports' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Gaming & esports' }));
    fireEvent.click(screen.getByRole('button', { name: 'Land brand or product partnerships' }));
    fireEvent.click(screen.getByRole('button', { name: /build my strategy/i }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Lead with gaming industry insight' })).toBeInTheDocument());
    expect(screen.getByText(/aim for 2 posts a week/i)).toBeInTheDocument();
    // "Positioning" is a glossary term (Task 3) and positioningNotes is rendered through
    // GlossaryText — the word must appear literally in the notes text for the chip to render,
    // so the fixture text above says "positioning" rather than paraphrasing around it.
    expect(screen.getByRole('button', { name: /^positioning$/i })).toBeInTheDocument();
  });

  it('returns to onboarding with the original niche and goal pre-selected after "Change niche or goal"', async () => {
    const existingStrategy = {
      id: 'strategy-1',
      niche: 'Gaming & esports',
      targetGoal: 'Land brand or product partnerships',
      contentPillars: ['Industry commentary'],
      postingCadenceRecommendation: 'Aim for 2 posts a week.',
      positioningNotes: 'Strong positioning as a rising voice in gaming will help you stand out.',
      headline: 'Lead with gaming industry insight',
      createdAt: '2026-09-09T00:00:00Z',
    };
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/linkedin/strategy') {
        return Promise.resolve(jsonResponse(200, { ok: true, latest: existingStrategy, history: [existingStrategy] }));
      }
      if (url === '/api/linkedin/ideas') {
        return Promise.resolve(jsonResponse(200, { ideas: { postIdeas: [] } }));
      }
      if (url === '/api/linkedin/audit') {
        return Promise.resolve(jsonResponse(200, { ok: true, history: [] }));
      }
      return Promise.resolve(jsonResponse(404, {}));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<LinkedInPage />);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Lead with gaming industry insight' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /change niche or goal/i }));

    const nicheButton = await screen.findByRole('button', { name: 'Gaming & esports' });
    const goalButton = screen.getByRole('button', { name: 'Land brand or product partnerships' });
    expect(nicheButton).toHaveAttribute('aria-pressed', 'true');
    expect(goalButton).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /build my strategy/i })).not.toBeDisabled();
  });
});
