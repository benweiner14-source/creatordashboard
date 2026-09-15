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
