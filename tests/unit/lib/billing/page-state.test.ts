import { describe, it, expect } from 'vitest';
import { billingPageReducer, createInitialBillingPageState } from '@/lib/billing/page-state';

describe('createInitialBillingPageState', () => {
  it('starts loading', () => {
    expect(createInitialBillingPageState()).toEqual({ status: 'loading' });
  });
});

describe('billingPageReducer', () => {
  it('moves to polling on START_POLLING', () => {
    const next = billingPageReducer({ status: 'loading' }, { type: 'START_POLLING' });
    expect(next).toEqual({ status: 'polling' });
  });

  it('moves to free on BOOTSTRAPPED with free data', () => {
    const next = billingPageReducer({ status: 'loading' }, { type: 'BOOTSTRAPPED', data: { status: 'free' } });
    expect(next).toEqual({ status: 'free' });
  });

  it('moves to subscribed on BOOTSTRAPPED with active data', () => {
    const next = billingPageReducer(
      { status: 'loading' },
      { type: 'BOOTSTRAPPED', data: { status: 'active', currentPeriodEnd: '2026-09-01T00:00:00Z', cancelAtPeriodEnd: false } }
    );
    expect(next).toEqual({ status: 'subscribed', currentPeriodEnd: '2026-09-01T00:00:00Z', cancelAtPeriodEnd: false, pastDue: false });
  });

  it('moves to subscribed with pastDue true on BOOTSTRAPPED with past_due data', () => {
    const next = billingPageReducer(
      { status: 'loading' },
      { type: 'BOOTSTRAPPED', data: { status: 'past_due', currentPeriodEnd: '2026-09-01T00:00:00Z', cancelAtPeriodEnd: false } }
    );
    expect(next).toEqual({ status: 'subscribed', currentPeriodEnd: '2026-09-01T00:00:00Z', cancelAtPeriodEnd: false, pastDue: true });
  });

  it('moves to free with justCheckedOut on POLL_EXHAUSTED', () => {
    const next = billingPageReducer({ status: 'polling' }, { type: 'POLL_EXHAUSTED' });
    expect(next).toEqual({ status: 'free', justCheckedOut: true });
  });

  it('moves to bootstrapFailed on BOOTSTRAP_FAILED', () => {
    const next = billingPageReducer({ status: 'loading' }, { type: 'BOOTSTRAP_FAILED' });
    expect(next).toEqual({ status: 'bootstrapFailed' });
  });
});
