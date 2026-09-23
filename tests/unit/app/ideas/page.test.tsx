import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { useSearchParamsMock } = vi.hoisted(() => ({
  useSearchParamsMock: vi.fn(() => new URLSearchParams()),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: useSearchParamsMock,
}));

vi.mock('@/components/AppNav', () => ({
  AppNav: () => null,
}));

import IdeasPage from '@/app/ideas/page';

describe('IdeasPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useSearchParamsMock.mockReturnValue(new URLSearchParams());
  });

  it('shows the GTA 6 focus form when no focus is set yet', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ niche: null, digest: null }) })
    );
    render(<IdeasPage />);
    await waitFor(() => expect(screen.getByText(/pick up to/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /^lore & leak theories/i })).toBeInTheDocument();
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

  it('shows a one-time tip about Meta\'s Edits app above the idea list once ideas are ready', async () => {
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
    expect(screen.getByText(/Meta's Edits app/)).toBeInTheDocument();
    expect(screen.getByText(/temporary reach boost/i)).toBeInTheDocument();
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

  it('threads a ?context= query param into the generate request', async () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams('context=GTA+6+trailer+breakdown'));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ niche: 'home baking', digest: null }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ digest: { id: 'd1', weekStart: '2026-08-10', contentIdeas: [] } }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<IdeasPage />);
    await waitFor(() => screen.getByRole('button', { name: /get this week's ideas/i }));
    fireEvent.click(screen.getByRole('button', { name: /get this week's ideas/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/ideas',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ context: 'GTA 6 trailer breakdown' }) })
      )
    );
  });

  it('does not show the "already generated" banner when context was actually used to generate fresh ideas', async () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams('context=GTA+6+trailer+breakdown'));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ niche: 'home baking', digest: null }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ digest: { id: 'd1', weekStart: '2026-08-10', contentIdeas: [] }, cached: false }),
      });
    vi.stubGlobal('fetch', fetchMock);

    render(<IdeasPage />);
    await waitFor(() => screen.getByRole('button', { name: /get this week's ideas/i }));
    fireEvent.click(screen.getByRole('button', { name: /get this week's ideas/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/already generated/i)).not.toBeInTheDocument();
  });

  it("shows a War-Room-specific notice when arriving with ?context= but this week's ideas already exist", async () => {
    // handleIdeasRequest short-circuits to the cached digest before `context`
    // is ever read, and bootstrap goes straight to ideasReady, so the generate
    // button (the only place context is threaded into a POST) never renders —
    // the user has to be told their alert context couldn't be used.
    useSearchParamsMock.mockReturnValue(new URLSearchParams('context=GTA+6+trailer+breakdown'));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        niche: 'home baking',
        digest: { id: 'd1', weekStart: '2026-08-10', contentIdeas: [] },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<IdeasPage />);

    await waitFor(() => expect(screen.getByText(/already generated/i)).toBeInTheDocument());
    expect(screen.getByText(/War Room alert/i)).toBeInTheDocument();
    expect(screen.queryByText(/your niche update will apply starting next week/i)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1); // bootstrap only — no POST
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
    // 'home baking' doesn't match any preset chip, so it round-trips through the "Other" field.
    expect(screen.getByLabelText(/describe your own focus/i)).toHaveValue('home baking');

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
    await waitFor(() => screen.getByText(/pick up to/i));
    fireEvent.click(screen.getByRole('button', { name: /^other$/i }));
    fireEvent.change(screen.getByLabelText(/describe your own focus/i), { target: { value: 'home baking' } });
    fireEvent.click(screen.getByRole('button', { name: /save niche/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: /get this week's ideas/i })).toBeInTheDocument());
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/ideas/niche',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ niche: 'home baking' }) })
    );
  });

  it('composes multiple selected chips into a comma-joined niche string', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ niche: null, digest: null }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<IdeasPage />);
    await waitFor(() => screen.getByText(/pick up to/i));
    fireEvent.click(screen.getByRole('button', { name: /^roleplay$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^speedrunning$/i }));
    fireEvent.click(screen.getByRole('button', { name: /save niche/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/ideas/niche',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ niche: 'Roleplay, Speedrunning' }) })
      )
    );
  });

  it('caps chip selection at 3 and disables the rest', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ niche: null, digest: null }) }));
    render(<IdeasPage />);
    await waitFor(() => screen.getByText(/pick up to/i));

    fireEvent.click(screen.getByRole('button', { name: /^roleplay$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^speedrunning$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^mod showcases$/i }));

    const fourthChip = screen.getByRole('button', { name: /^guides & tips$/i });
    expect(fourthChip).toBeDisabled();
    fireEvent.click(fourthChip);
    expect(fourthChip).toHaveAttribute('aria-pressed', 'false');
  });

  it('deselecting a chip frees up a slot for another selection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ niche: null, digest: null }) }));
    render(<IdeasPage />);
    await waitFor(() => screen.getByText(/pick up to/i));

    fireEvent.click(screen.getByRole('button', { name: /^roleplay$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^speedrunning$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^mod showcases$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^roleplay$/i })); // deselect

    const fourthChip = screen.getByRole('button', { name: /^guides & tips$/i });
    expect(fourthChip).not.toBeDisabled();
  });

  it('flags pre-launch-friendly focuses with the 🔥 marker', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ niche: null, digest: null }) }));
    render(<IdeasPage />);
    await waitFor(() => screen.getByText(/pick up to/i));

    expect(screen.getByRole('button', { name: /release-date speculation 🔥/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^guides & tips$/i })).toBeInTheDocument();
  });

  it('re-parses a previously saved niche back into its matching chips when editing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ niche: 'Roleplay, Speedrunning, a custom thing', digest: null }),
      })
    );
    render(<IdeasPage />);
    await waitFor(() => screen.getByText(/pick up to/i));

    expect(screen.getByRole('button', { name: /^roleplay$/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^speedrunning$/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^other$/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText(/describe your own focus/i)).toHaveValue('a custom thing');
  });
});
