import { describe, it, expect } from 'vitest';
import { strategyPageReducer, createInitialStrategyPageState, type StrategyHistoryItem } from '@/lib/strategy/page-state';

const SAMPLE_HISTORY: StrategyHistoryItem[] = [
  { id: 'strategy-1', platform: 'youtube', channelHandle: 'creator', headline: 'Great channel', createdAt: '2026-09-01T00:00:00Z' },
];

describe('createInitialStrategyPageState', () => {
  it('starts in loading', () => {
    expect(createInitialStrategyPageState()).toEqual({ status: 'loading' });
  });
});

describe('strategyPageReducer', () => {
  it('moves to idle with an empty URL and the bootstrapped history when bootstrap succeeds', () => {
    const state = strategyPageReducer({ status: 'loading' }, { type: 'BOOTSTRAPPED', history: SAMPLE_HISTORY });
    expect(state).toEqual({ status: 'idle', url: '', history: SAMPLE_HISTORY });
  });

  it('moves to idle with no history when bootstrap fails', () => {
    const state = strategyPageReducer({ status: 'loading' }, { type: 'BOOTSTRAP_FAILED' });
    expect(state).toEqual({ status: 'idle', url: '', history: [] });
  });

  it('moves to needsSignIn when bootstrap is unauthorized', () => {
    const state = strategyPageReducer({ status: 'loading' }, { type: 'BOOTSTRAP_UNAUTHORIZED' });
    expect(state).toEqual({ status: 'needsSignIn', email: '', notice: null });
  });

  it('moves to requiresUpgrade when bootstrap says payment is required', () => {
    const state = strategyPageReducer({ status: 'loading' }, { type: 'BOOTSTRAP_PAYMENT_REQUIRED' });
    expect(state).toEqual({ status: 'requiresUpgrade' });
  });

  it('updates the URL while idle, preserving history', () => {
    const state = strategyPageReducer(
      { status: 'idle', url: '', history: SAMPLE_HISTORY },
      { type: 'URL_CHANGED', value: 'https://youtube.com/@x' }
    );
    expect(state).toEqual({ status: 'idle', url: 'https://youtube.com/@x', history: SAMPLE_HISTORY });
  });

  it('moves to submitting on SUBMIT from idle, preserving history', () => {
    const state = strategyPageReducer(
      { status: 'idle', url: 'https://youtube.com/@x', history: SAMPLE_HISTORY },
      { type: 'SUBMIT' }
    );
    expect(state).toEqual({ status: 'submitting', url: 'https://youtube.com/@x', stillWorking: false, history: SAMPLE_HISTORY });
  });

  it('flags stillWorking while submitting, preserving history', () => {
    const state = strategyPageReducer(
      { status: 'submitting', url: 'https://youtube.com/@x', stillWorking: false, history: SAMPLE_HISTORY },
      { type: 'SUBMIT_STILL_WORKING' }
    );
    expect(state).toEqual({ status: 'submitting', url: 'https://youtube.com/@x', stillWorking: true, history: SAMPLE_HISTORY });
  });

  it('moves to redirecting on submit success', () => {
    const state = strategyPageReducer(
      { status: 'submitting', url: 'https://youtube.com/@x', stillWorking: false, history: SAMPLE_HISTORY },
      { type: 'SUBMIT_SUCCESS', id: 'strategy-2' }
    );
    expect(state).toEqual({ status: 'redirecting', id: 'strategy-2' });
  });

  it('moves to submitFailed with the error, preserving the URL and history', () => {
    const state = strategyPageReducer(
      { status: 'submitting', url: 'https://youtube.com/@x', stillWorking: true, history: SAMPLE_HISTORY },
      { type: 'SUBMIT_FAILED', error: 'Something broke' }
    );
    expect(state).toEqual({ status: 'submitFailed', url: 'https://youtube.com/@x', error: 'Something broke', history: SAMPLE_HISTORY });
  });

  it('allows re-submitting from submitFailed, preserving history', () => {
    const state = strategyPageReducer(
      { status: 'submitFailed', url: 'https://youtube.com/@x', error: 'oops', history: SAMPLE_HISTORY },
      { type: 'SUBMIT' }
    );
    expect(state).toEqual({ status: 'submitting', url: 'https://youtube.com/@x', stillWorking: false, history: SAMPLE_HISTORY });
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
  });

  it('ignores an invalid email on SUBMIT_EMAIL', () => {
    const state = strategyPageReducer({ status: 'needsSignIn', email: 'not-an-email', notice: null }, { type: 'SUBMIT_EMAIL' });
    expect(state).toEqual({ status: 'needsSignIn', email: 'not-an-email', notice: null });
  });
});
