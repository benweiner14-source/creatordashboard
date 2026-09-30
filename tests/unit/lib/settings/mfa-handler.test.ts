import { describe, it, expect, vi } from 'vitest';
import { handleEnrollMfa, type EnrollMfaDeps } from '@/lib/settings/mfa-handler';

describe('handleEnrollMfa', () => {
  it('returns 401 when not signed in', async () => {
    const result = await handleEnrollMfa({ enroll: vi.fn() }, { profileId: null });
    expect(result.status).toBe(401);
  });

  it('returns the factor id, QR code, and secret on success', async () => {
    const enroll = vi.fn().mockResolvedValue({
      data: { id: 'factor-1', totp: { qr_code: '<svg>...</svg>', secret: 'JBSWY3DPEHPK3PXP' } },
      error: null,
    });
    const deps: EnrollMfaDeps = { enroll };
    const result = await handleEnrollMfa(deps, { profileId: 'profile-1' });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ factorId: 'factor-1', qrCode: '<svg>...</svg>', secret: 'JBSWY3DPEHPK3PXP' });
  });

  it('returns 500 with a generic message when enrollment fails', async () => {
    const deps: EnrollMfaDeps = { enroll: vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } }) };
    const result = await handleEnrollMfa(deps, { profileId: 'profile-1' });
    expect(result.status).toBe(500);
    expect(result.body.error).toBe('Something went wrong setting up two-factor authentication. Please try again.');
  });
});
