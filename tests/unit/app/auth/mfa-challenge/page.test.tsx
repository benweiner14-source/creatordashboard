import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => new URLSearchParams('next=%2Fideas'),
}));

import MfaChallengePage from '@/app/auth/mfa-challenge/page';

describe('MfaChallengePage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    pushMock.mockClear();
  });

  it('submits the code and redirects to next on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
    render(<MfaChallengePage />);

    fireEvent.change(screen.getByLabelText(/verification code/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /verify/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/ideas'));
  });

  it('shows an error and does not redirect on an incorrect code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Incorrect code. Please try again.' }) }));
    render(<MfaChallengePage />);

    fireEvent.change(screen.getByLabelText(/verification code/i), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: /verify/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Incorrect code'));
    expect(pushMock).not.toHaveBeenCalled();
  });
});
