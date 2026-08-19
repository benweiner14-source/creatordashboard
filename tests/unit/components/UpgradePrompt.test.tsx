import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { UpgradePrompt } from '@/components/UpgradePrompt';

describe('UpgradePrompt', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    // jsdom doesn't implement navigation; assigning window.location.href
    // throws "Not implemented" unless stubbed per test.
    delete (window as unknown as { location?: unknown }).location;
    (window as unknown as { location: { href: string } }).location = { href: '' };
  });

  it('renders the given title and body', () => {
    render(<UpgradePrompt title="Recap Card is a paid feature" body="Upgrade to unlock it." />);
    expect(screen.getByText('Recap Card is a paid feature')).toBeInTheDocument();
    expect(screen.getByText('Upgrade to unlock it.')).toBeInTheDocument();
  });

  it('starts checkout and redirects on button click', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ url: 'https://checkout.stripe.com/pay/cs_1' }) }));
    render(<UpgradePrompt title="t" body="b" />);

    fireEvent.click(screen.getByRole('button', { name: /upgrade/i }));

    await waitFor(() => expect(window.location.href).toBe('https://checkout.stripe.com/pay/cs_1'));
  });

  it('shows an error message when checkout fails to start', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Something went wrong.' }) }));
    render(<UpgradePrompt title="t" body="b" />);

    fireEvent.click(screen.getByRole('button', { name: /upgrade/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong.'));
  });
});
