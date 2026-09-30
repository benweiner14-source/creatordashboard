import { describe, it, expect } from 'vitest';
import { homePageReducer, createInitialHomePageState, type HomePageState } from '@/lib/home/page-state';
import type { HomeData } from '@/lib/home/types';

const DATA: HomeData = {
  email: 'jordan@example.com',
  diagnostic: null,
  recap: null,
  ideas: { niche: null, digest: null },
};

describe('createInitialHomePageState', () => {
  it('starts in loading', () => {
    expect(createInitialHomePageState()).toEqual({ status: 'loading' });
  });
});

describe('homePageReducer', () => {
  it('moves to needsSignIn on BOOTSTRAP_UNAUTHORIZED', () => {
    expect(homePageReducer({ status: 'loading' }, { type: 'BOOTSTRAP_UNAUTHORIZED' })).toEqual({
      status: 'needsSignIn',
      email: '',
      notice: null,
    });
  });

  it('moves to bootstrapFailed on BOOTSTRAP_FAILED', () => {
    expect(homePageReducer({ status: 'loading' }, { type: 'BOOTSTRAP_FAILED' })).toEqual({ status: 'bootstrapFailed' });
  });

  it('moves to loaded on BOOTSTRAPPED, carrying the data', () => {
    expect(homePageReducer({ status: 'loading' }, { type: 'BOOTSTRAPPED', data: DATA })).toEqual({
      status: 'loaded',
      data: DATA,
    });
  });
});

// Mirrors tests/unit/lib/warroom/page-state.test.ts's "sign-in sub-flow"
// describe block exactly — this reducer is a distinct function, so nothing
// else would catch a future edit that broke sign-in here even though the
// logic is a byte-for-byte copy today.
describe('homePageReducer — sign-in sub-flow', () => {
  it('updates the email field from needsSignIn', () => {
    const state: HomePageState = { status: 'needsSignIn', email: '', notice: null };
    expect(homePageReducer(state, { type: 'EMAIL_CHANGED', email: 'a@b.com' })).toEqual({
      status: 'needsSignIn',
      email: 'a@b.com',
      notice: null,
    });
  });

  it('moves to submittingMagicLink on SUBMIT_EMAIL with a valid email', () => {
    const state: HomePageState = { status: 'needsSignIn', email: 'a@b.com', notice: null };
    expect(homePageReducer(state, { type: 'SUBMIT_EMAIL' })).toEqual({ status: 'submittingMagicLink', email: 'a@b.com' });
  });

  it('ignores SUBMIT_EMAIL with an invalid email', () => {
    const state: HomePageState = { status: 'needsSignIn', email: 'not-an-email', notice: null };
    expect(homePageReducer(state, { type: 'SUBMIT_EMAIL' })).toBe(state);
  });

  it('moves to checkEmail on MAGIC_LINK_SENT', () => {
    const state: HomePageState = { status: 'submittingMagicLink', email: 'a@b.com' };
    expect(homePageReducer(state, { type: 'MAGIC_LINK_SENT' })).toEqual({ status: 'checkEmail', email: 'a@b.com' });
  });

  it('moves to magicLinkError on MAGIC_LINK_FAILED', () => {
    const state: HomePageState = { status: 'submittingMagicLink', email: 'a@b.com' };
    expect(homePageReducer(state, { type: 'MAGIC_LINK_FAILED', error: 'boom' })).toEqual({
      status: 'magicLinkError',
      email: 'a@b.com',
      error: 'boom',
    });
  });

  it('moves back to submittingMagicLink on RESEND_EMAIL', () => {
    const state: HomePageState = { status: 'checkEmail', email: 'a@b.com' };
    expect(homePageReducer(state, { type: 'RESEND_EMAIL' })).toEqual({ status: 'submittingMagicLink', email: 'a@b.com' });
  });

  it('moves back to needsSignIn on RETRY_EMAIL', () => {
    const state: HomePageState = { status: 'checkEmail', email: 'a@b.com' };
    expect(homePageReducer(state, { type: 'RETRY_EMAIL' })).toEqual({ status: 'needsSignIn', email: 'a@b.com', notice: null });
  });
});
