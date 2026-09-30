import { describe, it, expect, vi } from 'vitest';
import { handleDeleteAccountRequest, type DeleteAccountDeps } from '@/lib/settings/delete-account-handler';
import { createInMemoryRateLimitStore } from '@/tests/fakes/rate-limit-store.fake';

function makeDeps(overrides: Partial<DeleteAccountDeps> = {}): DeleteAccountDeps {
  return {
    rateLimitStore: createInMemoryRateLimitStore(),
    getActiveStripeSubscriptionId: vi.fn().mockResolvedValue(null),
    cancelStripeSubscription: vi.fn().mockResolvedValue(undefined),
    scheduleDeletion: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('handleDeleteAccountRequest', () => {
  it('returns 401 when not signed in', async () => {
    const result = await handleDeleteAccountRequest(makeDeps(), { profileId: null });
    expect(result.status).toBe(401);
  });

  it('schedules deletion 14 days out and signs out, when there is no active subscription', async () => {
    const scheduleDeletion = vi.fn().mockResolvedValue(undefined);
    const signOut = vi.fn().mockResolvedValue(undefined);
    const cancelStripeSubscription = vi.fn();
    const now = new Date('2026-09-30T00:00:00Z');

    const result = await handleDeleteAccountRequest(
      makeDeps({ scheduleDeletion, signOut, cancelStripeSubscription }),
      { profileId: 'profile-1' },
      now
    );

    expect(result.status).toBe(200);
    expect(cancelStripeSubscription).not.toHaveBeenCalled();
    expect(scheduleDeletion).toHaveBeenCalledWith('profile-1', new Date('2026-10-14T00:00:00Z'));
    expect(signOut).toHaveBeenCalled();
  });

  it('cancels an active Stripe subscription before scheduling deletion', async () => {
    const cancelStripeSubscription = vi.fn().mockResolvedValue(undefined);
    const scheduleDeletion = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      getActiveStripeSubscriptionId: vi.fn().mockResolvedValue('sub_1'),
      cancelStripeSubscription,
      scheduleDeletion,
    });

    const result = await handleDeleteAccountRequest(deps, { profileId: 'profile-1' });

    expect(result.status).toBe(200);
    expect(cancelStripeSubscription).toHaveBeenCalledWith('sub_1');
    expect(scheduleDeletion).toHaveBeenCalled();
  });

  it('blocks the whole request if cancelling the subscription fails, without scheduling anything', async () => {
    const scheduleDeletion = vi.fn();
    const signOut = vi.fn();
    const deps = makeDeps({
      getActiveStripeSubscriptionId: vi.fn().mockResolvedValue('sub_1'),
      cancelStripeSubscription: vi.fn().mockRejectedValue(new Error('Stripe is down')),
      scheduleDeletion,
      signOut,
    });

    const result = await handleDeleteAccountRequest(deps, { profileId: 'profile-1' });

    expect(result.status).toBe(500);
    expect(scheduleDeletion).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it('rate-limits repeated deletion requests', async () => {
    const store = createInMemoryRateLimitStore();
    const deps = makeDeps({ rateLimitStore: store });
    for (let i = 0; i < 3; i++) {
      await handleDeleteAccountRequest(deps, { profileId: 'profile-1' });
    }
    const result = await handleDeleteAccountRequest(deps, { profileId: 'profile-1' });
    expect(result.status).toBe(429);
  });
});
