import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

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
});
