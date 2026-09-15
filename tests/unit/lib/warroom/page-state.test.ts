import { describe, it, expect } from 'vitest';
import { warroomPageReducer, createInitialWarroomPageState, type WarroomPageState } from '@/lib/warroom/page-state';
import type { WarroomAlertRow } from '@/lib/warroom/types';

const ALERT: WarroomAlertRow = {
  id: 'a1',
  platform: 'youtube',
  externalPostId: 'v1',
  url: 'https://example.com',
  captionOrTitle: 'GTA 6 news',
  viewCount: 300000,
  engagementCount: 1000,
  publishedAt: '2026-09-15T10:00:00Z',
  severity: 'already_viral',
  detectedAt: '2026-09-15T11:00:00Z',
};

describe('createInitialWarroomPageState', () => {
  it('starts in loading', () => {
    expect(createInitialWarroomPageState()).toEqual({ status: 'loading' });
  });
});

describe('warroomPageReducer', () => {
  it('moves to needsSignIn on BOOTSTRAP_UNAUTHORIZED', () => {
    expect(warroomPageReducer({ status: 'loading' }, { type: 'BOOTSTRAP_UNAUTHORIZED' })).toEqual({
      status: 'needsSignIn',
      email: '',
      notice: null,
    });
  });

  it('moves to requiresUpgrade on BOOTSTRAP_PAYMENT_REQUIRED', () => {
    expect(warroomPageReducer({ status: 'loading' }, { type: 'BOOTSTRAP_PAYMENT_REQUIRED' })).toEqual({
      status: 'requiresUpgrade',
    });
  });

  it('moves to bootstrapFailed on BOOTSTRAP_FAILED', () => {
    expect(warroomPageReducer({ status: 'loading' }, { type: 'BOOTSTRAP_FAILED' })).toEqual({ status: 'bootstrapFailed' });
  });

  it('moves to loaded on BOOTSTRAPPED, carrying the alerts and opt-in value', () => {
    const next = warroomPageReducer(
      { status: 'loading' },
      { type: 'BOOTSTRAPPED', alerts: [ALERT], emailOptIn: true }
    );
    expect(next).toEqual({ status: 'loaded', alerts: [ALERT], emailOptIn: true, optInError: null });
  });

  it('optimistically updates emailOptIn and clears any prior error on OPT_IN_TOGGLED', () => {
    const state: WarroomPageState = { status: 'loaded', alerts: [ALERT], emailOptIn: false, optInError: 'old error' };
    expect(warroomPageReducer(state, { type: 'OPT_IN_TOGGLED', optIn: true })).toEqual({
      status: 'loaded',
      alerts: [ALERT],
      emailOptIn: true,
      optInError: null,
    });
  });

  it('reverts to the previous value and sets an error on OPT_IN_SAVE_FAILED', () => {
    const state: WarroomPageState = { status: 'loaded', alerts: [ALERT], emailOptIn: true, optInError: null };
    expect(warroomPageReducer(state, { type: 'OPT_IN_SAVE_FAILED', previousValue: false, error: 'boom' })).toEqual({
      status: 'loaded',
      alerts: [ALERT],
      emailOptIn: false,
      optInError: 'boom',
    });
  });

  it('ignores OPT_IN_TOGGLED while loading (impossible-state guard)', () => {
    const state: WarroomPageState = { status: 'loading' };
    expect(warroomPageReducer(state, { type: 'OPT_IN_TOGGLED', optIn: true })).toBe(state);
  });
});

describe('warroomPageReducer — sign-in sub-flow', () => {
  // Mirrors tests/unit/lib/ideas/page-state.test.ts's "sign-in sub-flow"
  // describe block exactly — this reducer is a distinct function from
  // ideasPageReducer, so nothing else would catch a future edit that broke
  // sign-in here even though the logic is a byte-for-byte copy today.
  it('updates the email field from needsSignIn', () => {
    const state: WarroomPageState = { status: 'needsSignIn', email: '', notice: null };
    expect(warroomPageReducer(state, { type: 'EMAIL_CHANGED', email: 'a@b.com' })).toEqual({
      status: 'needsSignIn',
      email: 'a@b.com',
      notice: null,
    });
  });

  it('moves to submittingMagicLink on SUBMIT_EMAIL with a valid email', () => {
    const state: WarroomPageState = { status: 'needsSignIn', email: 'a@b.com', notice: null };
    expect(warroomPageReducer(state, { type: 'SUBMIT_EMAIL' })).toEqual({ status: 'submittingMagicLink', email: 'a@b.com' });
  });

  it('ignores SUBMIT_EMAIL with an invalid email', () => {
    const state: WarroomPageState = { status: 'needsSignIn', email: 'not-an-email', notice: null };
    expect(warroomPageReducer(state, { type: 'SUBMIT_EMAIL' })).toBe(state);
  });

  it('moves to checkEmail on MAGIC_LINK_SENT', () => {
    const state: WarroomPageState = { status: 'submittingMagicLink', email: 'a@b.com' };
    expect(warroomPageReducer(state, { type: 'MAGIC_LINK_SENT' })).toEqual({ status: 'checkEmail', email: 'a@b.com' });
  });

  it('moves to magicLinkError on MAGIC_LINK_FAILED', () => {
    const state: WarroomPageState = { status: 'submittingMagicLink', email: 'a@b.com' };
    expect(warroomPageReducer(state, { type: 'MAGIC_LINK_FAILED', error: 'boom' })).toEqual({
      status: 'magicLinkError',
      email: 'a@b.com',
      error: 'boom',
    });
  });

  it('moves back to submittingMagicLink on RESEND_EMAIL', () => {
    const state: WarroomPageState = { status: 'checkEmail', email: 'a@b.com' };
    expect(warroomPageReducer(state, { type: 'RESEND_EMAIL' })).toEqual({ status: 'submittingMagicLink', email: 'a@b.com' });
  });

  it('moves back to needsSignIn on RETRY_EMAIL', () => {
    const state: WarroomPageState = { status: 'checkEmail', email: 'a@b.com' };
    expect(warroomPageReducer(state, { type: 'RETRY_EMAIL' })).toEqual({ status: 'needsSignIn', email: 'a@b.com', notice: null });
  });
});
