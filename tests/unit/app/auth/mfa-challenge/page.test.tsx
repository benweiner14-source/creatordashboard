import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => new URLSearchParams('next=%2Fideas'),
}));

import MfaChallengePage from '@/app/auth/mfa-challenge/page';

// A realistic mock that distinguishes requests by URL, the way the real API
// does, rather than a blanket response for every fetch. This is what lets a
// test below actually catch a regression where `factorId` is sent as `null`
// instead of the value resolved from GET /api/settings/mfa/factors.
function mockFetchImpl(verifyOk: boolean) {
  return vi.fn((url: string, _init?: RequestInit) => {
    if (url === '/api/settings/mfa/factors') {
      return Promise.resolve({ ok: true, json: async () => ({ factorId: 'factor-abc-123' }) });
    }
    if (url === '/api/settings/mfa/verify') {
      return Promise.resolve({
        ok: verifyOk,
        json: async () => (verifyOk ? { ok: true } : { error: 'Incorrect code. Please try again.' }),
      });
    }
    return Promise.reject(new Error(`Unexpected fetch to ${url}`));
  });
}

describe('MfaChallengePage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    pushMock.mockClear();
  });

  it('submits the code and redirects to next on success', async () => {
    vi.stubGlobal('fetch', mockFetchImpl(true));
    render(<MfaChallengePage />);

    fireEvent.change(screen.getByLabelText(/verification code/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /verify/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/ideas'));
  });

  it('sends the real resolved factorId (not null) in the verify POST body', async () => {
    const fetchMock = mockFetchImpl(true);
    vi.stubGlobal('fetch', fetchMock);
    render(<MfaChallengePage />);

    fireEvent.change(screen.getByLabelText(/verification code/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /verify/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/ideas'));

    const verifyCall = fetchMock.mock.calls.find(([url]) => url === '/api/settings/mfa/verify');
    expect(verifyCall).toBeDefined();
    const body = JSON.parse((verifyCall?.[1]?.body ?? '{}') as string);
    expect(body.factorId).toBe('factor-abc-123');
    expect(body.factorId).not.toBeNull();
    expect(body.code).toBe('123456');
  });

  it('shows an error and does not redirect on an incorrect code', async () => {
    vi.stubGlobal('fetch', mockFetchImpl(false));
    render(<MfaChallengePage />);

    fireEvent.change(screen.getByLabelText(/verification code/i), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: /verify/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Incorrect code'));
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('shows an error and re-enables the submit button when the verify request fails to network', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === '/api/settings/mfa/factors') {
          return Promise.resolve({ ok: true, json: async () => ({ factorId: 'factor-abc-123' }) });
        }
        return Promise.reject(new Error('network down'));
      })
    );
    render(<MfaChallengePage />);

    fireEvent.change(screen.getByLabelText(/verification code/i), { target: { value: '123456' } });
    const button = screen.getByRole('button', { name: /verify/i });
    fireEvent.click(button);

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/network error/i));
    expect(pushMock).not.toHaveBeenCalled();
    expect(button).not.toBeDisabled();
  });
});
