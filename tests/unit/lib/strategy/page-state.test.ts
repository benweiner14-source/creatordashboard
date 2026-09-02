import { describe, it, expect } from 'vitest';
import { strategyPageReducer, createInitialStrategyPageState } from '@/lib/strategy/page-state';

describe('createInitialStrategyPageState', () => {
  it('starts in loading', () => {
    expect(createInitialStrategyPageState()).toEqual({ status: 'loading' });
  });
});

describe('strategyPageReducer', () => {
  it('moves to idle with an empty URL when bootstrap succeeds', () => {
    const state = strategyPageReducer({ status: 'loading' }, { type: 'BOOTSTRAPPED' });
    expect(state).toEqual({ status: 'idle', url: '' });
  });

  it('moves to needsSignIn when bootstrap is unauthorized', () => {
    const state = strategyPageReducer({ status: 'loading' }, { type: 'BOOTSTRAP_UNAUTHORIZED' });
    expect(state).toEqual({ status: 'needsSignIn', email: '', notice: null });
  });

  it('moves to requiresUpgrade when bootstrap says payment is required', () => {
    const state = strategyPageReducer({ status: 'loading' }, { type: 'BOOTSTRAP_PAYMENT_REQUIRED' });
    expect(state).toEqual({ status: 'requiresUpgrade' });
  });

  it('updates the URL while idle', () => {
    const state = strategyPageReducer({ status: 'idle', url: '' }, { type: 'URL_CHANGED', value: 'https://youtube.com/@x' });
    expect(state).toEqual({ status: 'idle', url: 'https://youtube.com/@x' });
  });

  it('moves to submitting on SUBMIT from idle', () => {
    const state = strategyPageReducer(
      { status: 'idle', url: 'https://youtube.com/@x' },
      { type: 'SUBMIT' }
    );
    expect(state).toEqual({ status: 'submitting', url: 'https://youtube.com/@x', stillWorking: false });
  });

  it('flags stillWorking while submitting', () => {
    const state = strategyPageReducer(
      { status: 'submitting', url: 'https://youtube.com/@x', stillWorking: false },
      { type: 'SUBMIT_STILL_WORKING' }
    );
    expect(state).toEqual({ status: 'submitting', url: 'https://youtube.com/@x', stillWorking: true });
  });

  it('moves to redirecting on submit success', () => {
    const state = strategyPageReducer(
      { status: 'submitting', url: 'https://youtube.com/@x', stillWorking: false },
      { type: 'SUBMIT_SUCCESS', id: 'strategy-1' }
    );
    expect(state).toEqual({ status: 'redirecting', id: 'strategy-1' });
  });

  it('moves to submitFailed with the error and preserves the URL', () => {
    const state = strategyPageReducer(
      { status: 'submitting', url: 'https://youtube.com/@x', stillWorking: true },
      { type: 'SUBMIT_FAILED', error: 'Something broke' }
    );
    expect(state).toEqual({ status: 'submitFailed', url: 'https://youtube.com/@x', error: 'Something broke' });
  });

  it('allows re-submitting from submitFailed', () => {
    const state = strategyPageReducer(
      { status: 'submitFailed', url: 'https://youtube.com/@x', error: 'oops' },
      { type: 'SUBMIT' }
    );
    expect(state).toEqual({ status: 'submitting', url: 'https://youtube.com/@x', stillWorking: false });
  });

  it('walks the full sign-in sub-flow', () => {
    let state = strategyPageReducer({ status: 'needsSignIn', email: '', notice: null }, { type: 'EMAIL_CHANGED', email: 'a@b.com' });
    expect(state).toEqual({ status: 'needsSignIn', email: 'a@b.com', notice: null });

    state = strategyPageReducer(state, { type: 'SUBMIT_EMAIL' });
    expect(state).toEqual({ status: 'submittingMagicLink', email: 'a@b.com' });

    state = strategyPageReducer(state, { type: 'MAGIC_LINK_SENT' });
    expect(state).toEqual({ status: 'checkEmail', email: 'a@b.com' });

    state = strategyPageReducer(state, { type: 'RESEND_EMAIL' });
    expect(state).toEqual({ status: 'submittingMagicLink', email: 'a@b.com' });

    state = strategyPageReducer(state, { type: 'MAGIC_LINK_FAILED', error: 'nope' });
    expect(state).toEqual({ status: 'magicLinkError', email: 'a@b.com', error: 'nope' });

    state = strategyPageReducer(state, { type: 'RETRY_EMAIL' });
    expect(state).toEqual({ status: 'needsSignIn', email: 'a@b.com', notice: null });
  });

  it('ignores an invalid email on SUBMIT_EMAIL', () => {
    const state = strategyPageReducer({ status: 'needsSignIn', email: 'not-an-email', notice: null }, { type: 'SUBMIT_EMAIL' });
    expect(state).toEqual({ status: 'needsSignIn', email: 'not-an-email', notice: null });
  });
});
