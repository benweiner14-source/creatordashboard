import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/components/AppNav', () => ({
  AppNav: () => null,
}));

import IdeasPage from '@/app/ideas/page';

describe('IdeasPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the GTA6 focus form when no focus is set yet', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ niche: null, digest: null }) })
    );
    render(<IdeasPage />);
    await waitFor(() => expect(screen.getByLabelText(/your gta6 focus/i)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /get this week's ideas/i })).not.toBeInTheDocument();
  });

  it('shows the idea cards directly when this week already has a digest', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          niche: 'home baking',
          digest: {
            id: 'digest-1',
            weekStart: '2026-08-10',
            contentIdeas: [
              {
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
              },
            ],
          },
        }),
      })
    );
    render(<IdeasPage />);
    await waitFor(() => expect(screen.getByText('Sourdough Speedrun')).toBeInTheDocument());
    expect(screen.getByText(/Bake a loaf in under 2 hours on camera/)).toBeInTheDocument();
  });

  it('does not show a cached notice on plain bootstrap of an existing digest', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          niche: 'home baking',
          digest: {
            id: 'digest-1',
            weekStart: '2026-08-10',
            contentIdeas: [
              {
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
              },
            ],
          },
        }),
      })
    );
    render(<IdeasPage />);
    await waitFor(() => expect(screen.getByText('Sourdough Speedrun')).toBeInTheDocument());
    // Bootstrap loading an existing digest is not itself a "your edit was ignored"
    // situation — the cached notice is specifically about a fresh POST that hit
    // the cache, so no notice should render on plain bootstrap.
    expect(screen.queryByText(/your niche update will apply starting next week/i)).not.toBeInTheDocument();
  });

  it('shows a cached notice after generating when the response says cached: true', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ niche: 'home baking', digest: null }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          cached: true,
          digest: {
            id: 'digest-2',
            weekStart: '2026-08-10',
            contentIdeas: [
              {
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
              },
            ],
          },
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    render(<IdeasPage />);
    await waitFor(() => screen.getByRole('button', { name: /get this week's ideas/i }));
    fireEvent.click(screen.getByRole('button', { name: /get this week's ideas/i }));

    await waitFor(() => expect(screen.getByText('Sourdough Speedrun')).toBeInTheDocument());
    expect(screen.getByText(/your niche update will apply starting next week/i)).toBeInTheDocument();
  });

  it('does not show a cached notice after a fresh (non-cached) generation', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ niche: 'home baking', digest: null }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          digest: {
            id: 'digest-3',
            weekStart: '2026-08-10',
            contentIdeas: [
              {
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
              },
            ],
          },
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    render(<IdeasPage />);
    await waitFor(() => screen.getByRole('button', { name: /get this week's ideas/i }));
    fireEvent.click(screen.getByRole('button', { name: /get this week's ideas/i }));

    await waitFor(() => expect(screen.getByText('Sourdough Speedrun')).toBeInTheDocument());
    expect(screen.queryByText(/your niche update will apply starting next week/i)).not.toBeInTheDocument();
  });

  it('does not render a clickable link for a javascript: sourceUrl', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ niche: 'home baking', digest: null }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          digest: {
            id: 'digest-4',
            weekStart: '2026-08-10',
            contentIdeas: [
              {
                workingTitle: 'Sourdough Speedrun',
                pitch: 'Bake a loaf in under 2 hours on camera',
                medium: 'reel',
                format: 'Speed Recap',
                whyItsHotNow: 'Sourdough resurgence trending this week',
                sourceUrl: 'javascript:alert(1)',
                whyItRanksHere: 'High reach from trend-jacking',
                kpiSignals: ['reach'],
                reelDetails: { suggestedLengthSeconds: 60, style: 'talking-head' },
                carouselDetails: null,
              },
            ],
          },
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    render(<IdeasPage />);
    await waitFor(() => screen.getByRole('button', { name: /get this week's ideas/i }));
    fireEvent.click(screen.getByRole('button', { name: /get this week's ideas/i }));

    await waitFor(() => expect(screen.getByText('Sourdough Speedrun')).toBeInTheDocument());
    const sourceLink = screen.queryByRole('link', { name: /source/i });
    if (sourceLink) {
      expect(sourceLink).not.toHaveAttribute('href', 'javascript:alert(1)');
    } else {
      expect(sourceLink).toBeNull();
    }
  });

  it('shows the generate button once a niche is set, and generating renders the returned ideas', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ niche: 'home baking', digest: null }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          digest: {
            id: 'digest-2',
            weekStart: '2026-08-10',
            contentIdeas: [
              {
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
              },
            ],
          },
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    render(<IdeasPage />);
    await waitFor(() => screen.getByRole('button', { name: /get this week's ideas/i }));
    fireEvent.click(screen.getByRole('button', { name: /get this week's ideas/i }));

    await waitFor(() => expect(screen.getByText('Sourdough Speedrun')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenLastCalledWith('/api/ideas', { method: 'POST' });
  });

  it('keeps the saved niche visible in the input while generating, instead of blanking it', async () => {
    let resolveGenerate: (value: unknown) => void = () => {};
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ niche: 'home baking', digest: null }) })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveGenerate = resolve;
          })
      );
    vi.stubGlobal('fetch', fetchMock);

    render(<IdeasPage />);
    await waitFor(() => screen.getByRole('button', { name: /get this week's ideas/i }));
    fireEvent.click(screen.getByRole('button', { name: /get this week's ideas/i }));

    // While the POST /api/ideas request is still pending, state.status === 'generating'.
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    expect(screen.getByLabelText(/your gta6 focus/i)).toHaveValue('home baking');

    resolveGenerate({
      ok: true,
      json: async () => ({ digest: { id: 'digest-3', weekStart: '2026-08-10', contentIdeas: [] } }),
    });
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });

  it('shows an error and a retry button when generation fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ niche: 'home baking', digest: null }) })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Couldn't find a real, current angle for your niche this week. Try again in a day or two." }),
      });
    vi.stubGlobal('fetch', fetchMock);

    render(<IdeasPage />);
    await waitFor(() => screen.getByRole('button', { name: /get this week's ideas/i }));
    fireEvent.click(screen.getByRole('button', { name: /get this week's ideas/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Couldn't find a real, current angle"));
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('shows the sign-in prompt when the bootstrap fetch is unauthorized', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'unauthorized' }) }));
    render(<IdeasPage />);
    await waitFor(() => expect(screen.getByLabelText('Email')).toBeInTheDocument());
  });

  it('saves the niche and shows the generate button on success', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ niche: null, digest: null }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<IdeasPage />);
    await waitFor(() => screen.getByLabelText(/your gta6 focus/i));
    fireEvent.change(screen.getByLabelText(/your gta6 focus/i), { target: { value: 'home baking' } });
    fireEvent.click(screen.getByRole('button', { name: /save niche/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: /get this week's ideas/i })).toBeInTheDocument());
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/ideas/niche',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ niche: 'home baking' }) })
    );
  });
});
