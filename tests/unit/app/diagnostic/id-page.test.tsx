import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'diagnostic-1' }),
}));

import DiagnosticReportPage from '@/app/diagnostic/[id]/page';

describe('DiagnosticReportPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the headline, score, and explanation with linked glossary terms', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({
          diagnostic: {
            report_json: {
              headline: 'Strong hook, moderate retention',
              scores: { overallScore: 72 },
              explanationSegments: [
                { type: 'text', value: 'Your ' },
                { type: 'term', value: 'hook rate' },
                { type: 'text', value: ' is strong.' },
              ],
            },
          },
        }),
      })
    );

    render(<DiagnosticReportPage />);

    expect(screen.getByText(/loading your report/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Strong hook, moderate retention')).toBeInTheDocument());
    expect(screen.getByText(/overall score: 72/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'hook rate' })).toBeInTheDocument();
  });

  it('shows the confidence caveat when the report includes one', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({
          diagnostic: {
            report_json: {
              headline: 'Too soon to tell',
              scores: { overallScore: 50 },
              explanationSegments: [{ type: 'text', value: 'Early days.' }],
              confidenceCaveat: 'This post is less than 3 hours old — early view/like counts can be misleading.',
            },
          },
        }),
      })
    );

    render(<DiagnosticReportPage />);

    await waitFor(() =>
      expect(screen.getByText(/less than 3 hours old/i)).toBeInTheDocument()
    );
  });

  it('shows an error message when the diagnostic is not found', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ error: 'Diagnostic not found.' }) }));
    render(<DiagnosticReportPage />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Diagnostic not found.'));
  });

  it('shows an error message when the network request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
    render(<DiagnosticReportPage />);
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong loading your report. Please try again.')
    );
  });

  it('shows the enrich button for a tiktok diagnostic with no visual/audio status yet', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({
          diagnostic: {
            platform: 'tiktok',
            visual_audio_status: null,
            visual_audio_narrative: null,
            report_json: {
              headline: 'Strong hook',
              scores: { overallScore: 72 },
              explanationSegments: [{ type: 'text', value: 'Good job.' }],
            },
          },
        }),
      })
    );

    render(<DiagnosticReportPage />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /see how your first 5 seconds/i })).toBeInTheDocument()
    );
  });

  it('does not show the enrich button for a non-tiktok diagnostic', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({
          diagnostic: {
            platform: 'instagram',
            visual_audio_status: null,
            visual_audio_narrative: null,
            report_json: {
              headline: 'Strong hook',
              scores: { overallScore: 72 },
              explanationSegments: [{ type: 'text', value: 'Good job.' }],
            },
          },
        }),
      })
    );

    render(<DiagnosticReportPage />);

    await waitFor(() => expect(screen.getByText('Strong hook')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /see how your first 5 seconds/i })).not.toBeInTheDocument();
  });

  it('clicking the enrich button shows the narrative on success', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({
          diagnostic: {
            platform: 'tiktok',
            visual_audio_status: null,
            visual_audio_narrative: null,
            report_json: {
              headline: 'Strong hook',
              scores: { overallScore: 72 },
              explanationSegments: [{ type: 'text', value: 'Good job.' }],
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ narrative: 'Your opening frame has clear on-screen text that stops the scroll.' }),
      });
    vi.stubGlobal('fetch', fetchMock);

    render(<DiagnosticReportPage />);
    const button = await screen.findByRole('button', { name: /see how your first 5 seconds/i });
    fireEvent.click(button);

    await waitFor(() =>
      expect(screen.getByText('Your opening frame has clear on-screen text that stops the scroll.')).toBeInTheDocument()
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain('/enrich');
  });

  it('shows a series badge when the analysis detects episode framing', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({
          diagnostic: {
            platform: 'tiktok',
            visual_audio_status: null,
            visual_audio_narrative: null,
            report_json: {
              headline: 'Strong hook',
              scores: { overallScore: 72 },
              explanationSegments: [{ type: 'text', value: 'Good job.' }],
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          narrative: 'A title card reads Episode 12.',
          isEpisodic: true,
          seriesLabel: 'Episode 12',
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    render(<DiagnosticReportPage />);
    const button = await screen.findByRole('button', { name: /see how your first 5 seconds/i });
    fireEvent.click(button);

    await waitFor(() => expect(screen.getByText((_, el) => el?.textContent === '📺 Part of a series: Episode 12')).toBeInTheDocument());
  });

  it('does not show a series badge when the analysis does not detect episode framing', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({
          diagnostic: {
            platform: 'tiktok',
            visual_audio_status: null,
            visual_audio_narrative: null,
            report_json: {
              headline: 'Strong hook',
              scores: { overallScore: 72 },
              explanationSegments: [{ type: 'text', value: 'Good job.' }],
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ narrative: 'A clear opening frame.', isEpisodic: false, seriesLabel: null }),
      });
    vi.stubGlobal('fetch', fetchMock);

    render(<DiagnosticReportPage />);
    const button = await screen.findByRole('button', { name: /see how your first 5 seconds/i });
    fireEvent.click(button);

    await waitFor(() => expect(screen.getByText('A clear opening frame.')).toBeInTheDocument());
    expect(screen.queryByText(/part of a series/i)).not.toBeInTheDocument();
  });

  it('shows a retry option when the enrich call fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({
          diagnostic: {
            platform: 'tiktok',
            visual_audio_status: null,
            visual_audio_narrative: null,
            report_json: {
              headline: 'Strong hook',
              scores: { overallScore: 72 },
              explanationSegments: [{ type: 'text', value: 'Good job.' }],
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Couldn't process this video — it may be too short or in an unsupported format." }),
      });
    vi.stubGlobal('fetch', fetchMock);

    render(<DiagnosticReportPage />);
    const button = await screen.findByRole('button', { name: /see how your first 5 seconds/i });
    fireEvent.click(button);

    await waitFor(() => expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument());
    expect(screen.getByText(/couldn't process this video/i)).toBeInTheDocument();
  });

  it('shows a retryable button when a previous analysis is stranded at pending', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({
          diagnostic: {
            platform: 'tiktok',
            visual_audio_status: 'pending',
            visual_audio_narrative: null,
            report_json: {
              headline: 'Strong hook',
              scores: { overallScore: 72 },
              explanationSegments: [{ type: 'text', value: 'Good job.' }],
            },
          },
        }),
      })
    );

    render(<DiagnosticReportPage />);

    // A row still at 'pending' means the request that wrote it died — the
    // section must not silently render nothing.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /may have been interrupted/i })).toBeInTheDocument()
    );
    expect(screen.queryByRole('button', { name: /see how your first 5 seconds/i })).not.toBeInTheDocument();
  });

  it('shows an upgrade link and no retry button when the enrich call returns 402', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({
          diagnostic: {
            platform: 'tiktok',
            visual_audio_status: null,
            visual_audio_narrative: null,
            report_json: {
              headline: 'Strong hook',
              scores: { overallScore: 72 },
              explanationSegments: [{ type: 'text', value: 'Good job.' }],
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 402,
        json: async () => ({
          error: 'Visual & Audio Analysis requires an active subscription.',
          upgradeUrl: '/billing',
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    render(<DiagnosticReportPage />);
    fireEvent.click(await screen.findByRole('button', { name: /see how your first 5 seconds/i }));

    await waitFor(() => expect(screen.getByText(/requires an active subscription/i)).toBeInTheDocument());
    const upgradeLink = screen.getByRole('link', { name: /upgrade to unlock this analysis/i });
    expect(upgradeLink).toHaveAttribute('href', '/billing');
    // A 402 persisted nothing server-side, so there is nothing to retry.
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  });

  it('shows a sign-in message and no retry button when the enrich call returns 401', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({
          diagnostic: {
            platform: 'tiktok',
            visual_audio_status: null,
            visual_audio_narrative: null,
            report_json: {
              headline: 'Strong hook',
              scores: { overallScore: 72 },
              explanationSegments: [{ type: 'text', value: 'Good job.' }],
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: 'You must be signed in to run this analysis.' }),
      });
    vi.stubGlobal('fetch', fetchMock);

    render(<DiagnosticReportPage />);
    fireEvent.click(await screen.findByRole('button', { name: /see how your first 5 seconds/i }));

    await waitFor(() => expect(screen.getByText(/sign in again/i)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  });

  it('shows the platform message and no retry button when the enrich call returns 422', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({
          diagnostic: {
            platform: 'tiktok',
            visual_audio_status: null,
            visual_audio_narrative: null,
            report_json: {
              headline: 'Strong hook',
              scores: { overallScore: 72 },
              explanationSegments: [{ type: 'text', value: 'Good job.' }],
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: async () => ({ error: 'Visual & Audio Analysis is not available for youtube yet.' }),
      });
    vi.stubGlobal('fetch', fetchMock);

    render(<DiagnosticReportPage />);
    fireEvent.click(await screen.findByRole('button', { name: /see how your first 5 seconds/i }));

    await waitFor(() => expect(screen.getByText(/not available for youtube yet/i)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  });
});
