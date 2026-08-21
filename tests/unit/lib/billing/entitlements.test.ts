import { describe, it, expect } from 'vitest';
import { hasActiveSubscription } from '@/lib/billing/entitlements';

function makeSupabaseStub(row: { status: string } | null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: row, error: null }),
        }),
      }),
    }),
  } as any;
}

describe('hasActiveSubscription', () => {
  it('is true for an active subscription', async () => {
    expect(await hasActiveSubscription(makeSupabaseStub({ status: 'active' }), 'profile-1')).toBe(true);
  });

  it('is true for a past_due subscription (payment-retry grace period)', async () => {
    expect(await hasActiveSubscription(makeSupabaseStub({ status: 'past_due' }), 'profile-1')).toBe(true);
  });

  it('is false for a canceled subscription', async () => {
    expect(await hasActiveSubscription(makeSupabaseStub({ status: 'canceled' }), 'profile-1')).toBe(false);
  });

  it('is false for an incomplete subscription', async () => {
    expect(await hasActiveSubscription(makeSupabaseStub({ status: 'incomplete' }), 'profile-1')).toBe(false);
  });

  it('is false when no subscription row exists', async () => {
    expect(await hasActiveSubscription(makeSupabaseStub(null), 'profile-1')).toBe(false);
  });
});
