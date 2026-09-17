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
});
