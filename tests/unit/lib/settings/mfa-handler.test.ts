import { describe, it, expect, vi } from 'vitest';
import { handleEnrollMfa, type EnrollMfaDeps } from '@/lib/settings/mfa-handler';
import { handleVerifyMfa, handleDisableMfa, type VerifyMfaDeps, type DisableMfaDeps } from '@/lib/settings/mfa-handler';
import { createInMemoryRateLimitStore } from '@/tests/fakes/rate-limit-store.fake';

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

describe('handleVerifyMfa', () => {
  function makeDeps(overrides: Partial<VerifyMfaDeps> = {}): VerifyMfaDeps {
    return {
      rateLimitStore: createInMemoryRateLimitStore(),
      challengeAndVerify: vi.fn().mockResolvedValue({ error: null }),
      ...overrides,
    };
  }

  it('returns 401 when not signed in', async () => {
    const result = await handleVerifyMfa(makeDeps(), { profileId: null, factorId: 'factor-1', code: '123456' });
    expect(result.status).toBe(401);
  });

  it('verifies a correct code', async () => {
    const challengeAndVerify = vi.fn().mockResolvedValue({ error: null });
    const result = await handleVerifyMfa(makeDeps({ challengeAndVerify }), {
      profileId: 'profile-1',
      factorId: 'factor-1',
      code: '123456',
    });
    expect(result.status).toBe(200);
    expect(challengeAndVerify).toHaveBeenCalledWith('factor-1', '123456');
  });

  it('returns 400 with a generic message on an incorrect code', async () => {
    const deps = makeDeps({ challengeAndVerify: vi.fn().mockResolvedValue({ error: { message: 'Invalid TOTP code' } }) });
    const result = await handleVerifyMfa(deps, { profileId: 'profile-1', factorId: 'factor-1', code: '000000' });
    expect(result.status).toBe(400);
    expect(result.body.error).toBe('Incorrect code. Please try again.');
  });

  it('rate-limits repeated attempts for the same profile', async () => {
    const store = createInMemoryRateLimitStore();
    const deps = makeDeps({ rateLimitStore: store, challengeAndVerify: vi.fn().mockResolvedValue({ error: { message: 'bad' } }) });
    for (let i = 0; i < 5; i++) {
      await handleVerifyMfa(deps, { profileId: 'profile-1', factorId: 'factor-1', code: '000000' });
    }
    const result = await handleVerifyMfa(deps, { profileId: 'profile-1', factorId: 'factor-1', code: '000000' });
    expect(result.status).toBe(429);
  });
});

describe('handleDisableMfa', () => {
  function makeDeps(overrides: Partial<DisableMfaDeps> = {}): DisableMfaDeps {
    return {
      rateLimitStore: createInMemoryRateLimitStore(),
      challengeAndVerify: vi.fn().mockResolvedValue({ error: null }),
      unenroll: vi.fn().mockResolvedValue({ error: null }),
      ...overrides,
    };
  }

  it('returns 401 when not signed in', async () => {
    const result = await handleDisableMfa(makeDeps(), { profileId: null, factorId: 'factor-1', code: '123456' });
    expect(result.status).toBe(401);
  });

  it('requires a valid code before unenrolling', async () => {
    const unenroll = vi.fn().mockResolvedValue({ error: null });
    const deps = makeDeps({ unenroll });
    const result = await handleDisableMfa(deps, { profileId: 'profile-1', factorId: 'factor-1', code: '123456' });
    expect(result.status).toBe(200);
    expect(unenroll).toHaveBeenCalledWith('factor-1');
  });

  it('does not unenroll when the code is wrong', async () => {
    const unenroll = vi.fn();
    const deps = makeDeps({ challengeAndVerify: vi.fn().mockResolvedValue({ error: { message: 'bad' } }), unenroll });
    const result = await handleDisableMfa(deps, { profileId: 'profile-1', factorId: 'factor-1', code: '000000' });
    expect(result.status).toBe(400);
    expect(unenroll).not.toHaveBeenCalled();
  });
});
