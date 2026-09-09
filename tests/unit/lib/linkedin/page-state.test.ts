// tests/unit/lib/linkedin/page-state.test.ts
import { describe, it, expect } from 'vitest';
import { linkedInPageReducer, createInitialLinkedInPageState, type LinkedInStrategyData, type LinkedInStrategyHistoryItem } from '@/lib/linkedin/page-state';

const SAMPLE_STRATEGY: LinkedInStrategyData = {
  id: 'strategy-1',
  niche: 'Gaming & esports',
  targetGoal: 'Land brand or product partnerships',
  contentPillars: ['Industry commentary'],
  postingCadenceRecommendation: 'Aim for 2 posts a week.',
  positioningNotes: 'Position yourself as a rising voice in gaming.',
  headline: 'Lead with gaming industry insight',
  createdAt: '2026-09-09T00:00:00Z',
};

const SAMPLE_HISTORY_ITEM: LinkedInStrategyHistoryItem = {
  id: 'strategy-1',
  niche: 'Gaming & esports',
  targetGoal: 'Land brand or product partnerships',
  headline: 'Lead with gaming industry insight',
  createdAt: '2026-09-09T00:00:00Z',
};

describe('createInitialLinkedInPageState', () => {
  it('starts in loading', () => {
    expect(createInitialLinkedInPageState()).toEqual({ status: 'loading' });
  });
});

describe('linkedInPageReducer', () => {
  it('moves to strategyReady when bootstrap returns a strategy', () => {
    const state = linkedInPageReducer({ status: 'loading' }, { type: 'BOOTSTRAPPED', strategy: SAMPLE_STRATEGY, history: [SAMPLE_HISTORY_ITEM] });
    expect(state).toEqual({ status: 'strategyReady', strategy: SAMPLE_STRATEGY, history: [SAMPLE_HISTORY_ITEM] });
  });

  it('moves to onboarding when bootstrap returns no strategy yet', () => {
    const state = linkedInPageReducer({ status: 'loading' }, { type: 'BOOTSTRAPPED', strategy: null, history: [] });
    expect(state).toEqual({ status: 'onboarding', prefillNiche: '', prefillTargetGoal: '', history: [] });
  });

  it('moves to onboarding when bootstrap fails', () => {
    const state = linkedInPageReducer({ status: 'loading' }, { type: 'BOOTSTRAP_FAILED' });
    expect(state).toEqual({ status: 'onboarding', prefillNiche: '', prefillTargetGoal: '', history: [] });
  });

  it('moves to needsSignIn when bootstrap is unauthorized', () => {
    const state = linkedInPageReducer({ status: 'loading' }, { type: 'BOOTSTRAP_UNAUTHORIZED' });
    expect(state).toEqual({ status: 'needsSignIn', email: '', notice: null });
  });

  it('moves to requiresUpgrade when bootstrap says payment is required', () => {
    const state = linkedInPageReducer({ status: 'loading' }, { type: 'BOOTSTRAP_PAYMENT_REQUIRED' });
    expect(state).toEqual({ status: 'requiresUpgrade' });
  });

  it('ignores an empty niche or goal on GENERATE', () => {
    const state = linkedInPageReducer({ status: 'onboarding', prefillNiche: '', prefillTargetGoal: '', history: [] }, { type: 'GENERATE', niche: '', targetGoal: 'Partnerships' });
    expect(state.status).toBe('onboarding');
  });

  it('moves to generating on GENERATE with both fields filled', () => {
    const state = linkedInPageReducer(
      { status: 'onboarding', prefillNiche: '', prefillTargetGoal: '', history: [] },
      { type: 'GENERATE', niche: 'Gaming & esports', targetGoal: 'Land brand or product partnerships' }
    );
    expect(state).toEqual({ status: 'generating', niche: 'Gaming & esports', targetGoal: 'Land brand or product partnerships', stillWorking: false, history: [] });
  });

  it('flags stillWorking while generating', () => {
    const state = linkedInPageReducer(
      { status: 'generating', niche: 'Gaming', targetGoal: 'Partnerships', stillWorking: false, history: [] },
      { type: 'GENERATE_STILL_WORKING' }
    );
    expect(state).toEqual({ status: 'generating', niche: 'Gaming', targetGoal: 'Partnerships', stillWorking: true, history: [] });
  });

  it('moves to strategyReady on GENERATE_SUCCESS, prepending the new strategy to history', () => {
    const state = linkedInPageReducer(
      { status: 'generating', niche: 'Gaming & esports', targetGoal: 'Land brand or product partnerships', stillWorking: false, history: [] },
      { type: 'GENERATE_SUCCESS', strategy: SAMPLE_STRATEGY }
    );
    expect(state).toEqual({ status: 'strategyReady', strategy: SAMPLE_STRATEGY, history: [SAMPLE_HISTORY_ITEM] });
  });

  it('moves to generationFailed on GENERATE_FAILED, preserving the inputs', () => {
    const state = linkedInPageReducer(
      { status: 'generating', niche: 'Gaming', targetGoal: 'Partnerships', stillWorking: true, history: [] },
      { type: 'GENERATE_FAILED', error: 'Something broke' }
    );
    expect(state).toEqual({ status: 'generationFailed', niche: 'Gaming', targetGoal: 'Partnerships', error: 'Something broke', history: [] });
  });

  it('allows re-submitting from generationFailed', () => {
    const state = linkedInPageReducer(
      { status: 'generationFailed', niche: 'Gaming', targetGoal: 'Partnerships', error: 'oops', history: [] },
      { type: 'GENERATE', niche: 'Gaming', targetGoal: 'Partnerships' }
    );
    expect(state.status).toBe('generating');
  });

  it('moves back to onboarding, prefilled, on EDIT_STRATEGY_INPUTS from strategyReady', () => {
    const state = linkedInPageReducer(
      { status: 'strategyReady', strategy: SAMPLE_STRATEGY, history: [SAMPLE_HISTORY_ITEM] },
      { type: 'EDIT_STRATEGY_INPUTS' }
    );
    expect(state).toEqual({
      status: 'onboarding',
      prefillNiche: 'Gaming & esports',
      prefillTargetGoal: 'Land brand or product partnerships',
      history: [SAMPLE_HISTORY_ITEM],
    });
  });

  it('walks the full sign-in sub-flow', () => {
    let state = linkedInPageReducer({ status: 'needsSignIn', email: '', notice: null }, { type: 'EMAIL_CHANGED', email: 'a@b.com' });
    expect(state).toEqual({ status: 'needsSignIn', email: 'a@b.com', notice: null });

    state = linkedInPageReducer(state, { type: 'SUBMIT_EMAIL' });
    expect(state).toEqual({ status: 'submittingMagicLink', email: 'a@b.com' });

    state = linkedInPageReducer(state, { type: 'MAGIC_LINK_SENT' });
    expect(state).toEqual({ status: 'checkEmail', email: 'a@b.com' });

    state = linkedInPageReducer(state, { type: 'RESEND_EMAIL' });
    expect(state).toEqual({ status: 'submittingMagicLink', email: 'a@b.com' });

    state = linkedInPageReducer(state, { type: 'MAGIC_LINK_FAILED', error: 'nope' });
    expect(state).toEqual({ status: 'magicLinkError', email: 'a@b.com', error: 'nope' });
  });

  it('ignores an invalid email on SUBMIT_EMAIL', () => {
    const state = linkedInPageReducer({ status: 'needsSignIn', email: 'not-an-email', notice: null }, { type: 'SUBMIT_EMAIL' });
    expect(state).toEqual({ status: 'needsSignIn', email: 'not-an-email', notice: null });
  });
});
