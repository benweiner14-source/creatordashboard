import { describe, it, expect } from 'vitest';
import { settingsPageReducer, createInitialSettingsPageState } from '@/lib/settings/page-state';

describe('createInitialSettingsPageState', () => {
  it('starts loading', () => {
    expect(createInitialSettingsPageState()).toEqual({ status: 'loading' });
  });
});

describe('settingsPageReducer', () => {
  it('moves to loaded on BOOTSTRAPPED', () => {
    expect(
      settingsPageReducer({ status: 'loading' }, { type: 'BOOTSTRAPPED', data: { email: 'creator@example.com' } })
    ).toEqual({
      status: 'loaded',
      data: { email: 'creator@example.com' },
    });
  });

  it('moves to bootstrapFailed on BOOTSTRAP_FAILED', () => {
    expect(settingsPageReducer({ status: 'loading' }, { type: 'BOOTSTRAP_FAILED' })).toEqual({
      status: 'bootstrapFailed',
    });
  });

  it('moves to needsSignIn on BOOTSTRAP_UNAUTHORIZED', () => {
    expect(settingsPageReducer({ status: 'loading' }, { type: 'BOOTSTRAP_UNAUTHORIZED' })).toEqual({
      status: 'needsSignIn',
      email: '',
      notice: null,
    });
  });

  it('runs the sign-in sub-flow through to checkEmail', () => {
    const typed = settingsPageReducer(
      { status: 'needsSignIn', email: '', notice: null },
      { type: 'EMAIL_CHANGED', email: 'creator@example.com' }
    );
    const submitting = settingsPageReducer(typed, { type: 'SUBMIT_EMAIL' });
    expect(submitting).toEqual({ status: 'submittingMagicLink', email: 'creator@example.com' });
    expect(settingsPageReducer(submitting, { type: 'MAGIC_LINK_SENT' })).toEqual({
      status: 'checkEmail',
      email: 'creator@example.com',
    });
  });

  it('keeps the email on MAGIC_LINK_FAILED so it can be retried', () => {
    expect(
      settingsPageReducer(
        { status: 'submittingMagicLink', email: 'creator@example.com' },
        { type: 'MAGIC_LINK_FAILED', error: 'boom' }
      )
    ).toEqual({ status: 'magicLinkError', email: 'creator@example.com', error: 'boom' });
  });
});
