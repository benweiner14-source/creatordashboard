import { describe, it, expect } from 'vitest';
import { billingPageReducer, createInitialBillingPageState } from '@/lib/billing/page-state';
import type { BillingPageState } from '@/lib/billing/page-state';

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

  // Sign-in sub-flow, mirroring lib/recap/page-state.ts so the same
  // <SignInPrompt> component drives it.
  it('moves to needsSignIn when the bootstrap request comes back unauthorized', () => {
    expect(billingPageReducer({ status: 'loading' }, { type: 'BOOTSTRAP_UNAUTHORIZED' })).toEqual({
      status: 'needsSignIn',
      email: '',
      notice: null,
    });
  });

  it('updates the email and moves to submittingMagicLink on SUBMIT_EMAIL with a valid address', () => {
    const typed = billingPageReducer(
      { status: 'needsSignIn', email: '', notice: null },
      { type: 'EMAIL_CHANGED', email: 'creator@example.com' }
    );
    expect(typed).toEqual({ status: 'needsSignIn', email: 'creator@example.com', notice: null });
    expect(billingPageReducer(typed, { type: 'SUBMIT_EMAIL' })).toEqual({
      status: 'submittingMagicLink',
      email: 'creator@example.com',
    });
  });

  it('ignores SUBMIT_EMAIL with an invalid address', () => {
    const state: BillingPageState = { status: 'needsSignIn', email: 'nope', notice: null };
    expect(billingPageReducer(state, { type: 'SUBMIT_EMAIL' })).toBe(state);
  });

  it('moves to checkEmail on MAGIC_LINK_SENT and back to submitting on RESEND_EMAIL', () => {
    const sent = billingPageReducer(
      { status: 'submittingMagicLink', email: 'creator@example.com' },
      { type: 'MAGIC_LINK_SENT' }
    );
    expect(sent).toEqual({ status: 'checkEmail', email: 'creator@example.com' });
    expect(billingPageReducer(sent, { type: 'RESEND_EMAIL' })).toEqual({
      status: 'submittingMagicLink',
      email: 'creator@example.com',
    });
    expect(billingPageReducer(sent, { type: 'RETRY_EMAIL' })).toEqual({
      status: 'needsSignIn',
      email: 'creator@example.com',
      notice: null,
    });
  });

  it('keeps the email on MAGIC_LINK_FAILED so it can be retried', () => {
    expect(
      billingPageReducer({ status: 'submittingMagicLink', email: 'creator@example.com' }, { type: 'MAGIC_LINK_FAILED', error: 'boom' })
    ).toEqual({ status: 'magicLinkError', email: 'creator@example.com', error: 'boom' });
  });
});
