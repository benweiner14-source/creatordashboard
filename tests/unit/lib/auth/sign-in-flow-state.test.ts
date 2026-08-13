import { describe, it, expect } from 'vitest';
import {
  signInFlowReducer,
  createInitialSignInFlowState,
  isValidEmailFormat,
  isValidUrlFormat,
  type SignInFlowState,
} from '@/lib/auth/sign-in-flow-state';

describe('createInitialSignInFlowState', () => {
  it('starts idle with an empty url by default', () => {
    expect(createInitialSignInFlowState()).toEqual({ status: 'idle', url: '', error: null });
  });

  it('starts idle with a restored url when only url is provided', () => {
    expect(createInitialSignInFlowState({ url: 'https://tiktok.com/x' })).toEqual({
      status: 'idle',
      url: 'https://tiktok.com/x',
      error: null,
    });
  });

  it('starts in needsSignIn with a notice when authError=expired and a url are both present', () => {
    expect(createInitialSignInFlowState({ url: 'https://tiktok.com/x', authError: 'expired' })).toEqual({
      status: 'needsSignIn',
      url: 'https://tiktok.com/x',
      email: '',
      notice:
        "That sign-in link didn't work — it may have expired, already been used, or been opened on a different device than the one you requested it from. Enter your email again to get a new one.",
    });
  });

  it('ignores authError=expired without a url and starts idle', () => {
    expect(createInitialSignInFlowState({ authError: 'expired' })).toEqual({ status: 'idle', url: '', error: null });
  });
});

describe('signInFlowReducer — diagnostic submission path', () => {
  it('moves from idle to submittingDiagnostic on a valid SUBMIT_DIAGNOSTIC', () => {
    const state: SignInFlowState = { status: 'idle', url: 'https://tiktok.com/x', error: null };
    const next = signInFlowReducer(state, { type: 'SUBMIT_DIAGNOSTIC' });
    expect(next).toEqual({ status: 'submittingDiagnostic', url: 'https://tiktok.com/x', stillWorking: false });
  });

  it('ignores SUBMIT_DIAGNOSTIC with an empty url', () => {
    const state: SignInFlowState = { status: 'idle', url: '', error: null };
    expect(signInFlowReducer(state, { type: 'SUBMIT_DIAGNOSTIC' })).toBe(state);
  });

  it('sets stillWorking on DIAGNOSTIC_STILL_WORKING without changing status', () => {
    const state: SignInFlowState = { status: 'submittingDiagnostic', url: 'https://tiktok.com/x', stillWorking: false };
    const next = signInFlowReducer(state, { type: 'DIAGNOSTIC_STILL_WORKING' });
    expect(next).toEqual({ status: 'submittingDiagnostic', url: 'https://tiktok.com/x', stillWorking: true });
  });

  it('moves to redirectingToReport on DIAGNOSTIC_SUCCESS', () => {
    const state: SignInFlowState = { status: 'submittingDiagnostic', url: 'https://tiktok.com/x', stillWorking: true };
    const next = signInFlowReducer(state, { type: 'DIAGNOSTIC_SUCCESS', diagnosticId: 'diag-1' });
    expect(next).toEqual({ status: 'redirectingToReport', url: 'https://tiktok.com/x', diagnosticId: 'diag-1' });
  });

  it('moves to needsSignIn with no notice on DIAGNOSTIC_UNAUTHORIZED', () => {
    const state: SignInFlowState = { status: 'submittingDiagnostic', url: 'https://tiktok.com/x', stillWorking: false };
    const next = signInFlowReducer(state, { type: 'DIAGNOSTIC_UNAUTHORIZED' });
    expect(next).toEqual({ status: 'needsSignIn', url: 'https://tiktok.com/x', email: '', notice: null });
  });

  it('moves to diagnosticError preserving the url on DIAGNOSTIC_FAILED', () => {
    const state: SignInFlowState = { status: 'submittingDiagnostic', url: 'https://tiktok.com/x', stillWorking: false };
    const next = signInFlowReducer(state, { type: 'DIAGNOSTIC_FAILED', error: 'boom' });
    expect(next).toEqual({ status: 'diagnosticError', url: 'https://tiktok.com/x', error: 'boom' });
  });

  it('ignores URL_CHANGED while a submission is in flight (impossible-state guard)', () => {
    const state: SignInFlowState = { status: 'submittingDiagnostic', url: 'https://tiktok.com/x', stillWorking: false };
    expect(signInFlowReducer(state, { type: 'URL_CHANGED', url: 'https://tiktok.com/y' })).toBe(state);
  });

  it('updates the url on URL_CHANGED from idle', () => {
    const state: SignInFlowState = { status: 'idle', url: 'https://tiktok.com/x', error: null };
    expect(signInFlowReducer(state, { type: 'URL_CHANGED', url: 'https://tiktok.com/y' })).toEqual({
      status: 'idle',
      url: 'https://tiktok.com/y',
      error: null,
    });
  });

  it('updates the url on URL_CHANGED from diagnosticError', () => {
    const state: SignInFlowState = { status: 'diagnosticError', url: 'https://tiktok.com/x', error: 'boom' };
    expect(signInFlowReducer(state, { type: 'URL_CHANGED', url: 'https://tiktok.com/y' })).toEqual({
      status: 'diagnosticError',
      url: 'https://tiktok.com/y',
      error: 'boom',
    });
  });
});

describe('signInFlowReducer — sign-in path', () => {
  it('returns to idle on EDIT_URL from needsSignIn', () => {
    const state: SignInFlowState = { status: 'needsSignIn', url: 'https://tiktok.com/x', email: '', notice: null };
    expect(signInFlowReducer(state, { type: 'EDIT_URL' })).toEqual({
      status: 'idle',
      url: 'https://tiktok.com/x',
      error: null,
    });
  });

  it('returns to idle preserving the url on EDIT_URL from magicLinkError', () => {
    const state: SignInFlowState = {
      status: 'magicLinkError',
      url: 'https://tiktok.com/x',
      email: 'creator@example.com',
      error: 'boom',
    };
    expect(signInFlowReducer(state, { type: 'EDIT_URL' })).toEqual({
      status: 'idle',
      url: 'https://tiktok.com/x',
      error: null,
    });
  });

  it('updates the email on EMAIL_CHANGED from needsSignIn, preserving url and notice', () => {
    const state: SignInFlowState = {
      status: 'needsSignIn',
      url: 'https://tiktok.com/x',
      email: '',
      notice:
        "That sign-in link didn't work — it may have expired, already been used, or been opened on a different device than the one you requested it from. Enter your email again to get a new one.",
    };
    expect(signInFlowReducer(state, { type: 'EMAIL_CHANGED', email: 'creator@example.com' })).toEqual({
      status: 'needsSignIn',
      url: 'https://tiktok.com/x',
      email: 'creator@example.com',
      notice:
        "That sign-in link didn't work — it may have expired, already been used, or been opened on a different device than the one you requested it from. Enter your email again to get a new one.",
    });
  });

  it('updates the email on EMAIL_CHANGED from magicLinkError, preserving url and error', () => {
    const state: SignInFlowState = {
      status: 'magicLinkError',
      url: 'https://tiktok.com/x',
      email: 'creator@example.com',
      error: 'boom',
    };
    expect(signInFlowReducer(state, { type: 'EMAIL_CHANGED', email: 'creator2@example.com' })).toEqual({
      status: 'magicLinkError',
      url: 'https://tiktok.com/x',
      email: 'creator2@example.com',
      error: 'boom',
    });
  });

  it('ignores EMAIL_CHANGED from an unrelated state (impossible-state guard)', () => {
    const state: SignInFlowState = { status: 'idle', url: 'https://tiktok.com/x', error: null };
    expect(signInFlowReducer(state, { type: 'EMAIL_CHANGED', email: 'creator@example.com' })).toBe(state);
  });

  it('ignores SUBMIT_EMAIL with an invalid email format (impossible-state guard)', () => {
    const state: SignInFlowState = { status: 'needsSignIn', url: 'https://tiktok.com/x', email: 'not-an-email', notice: null };
    expect(signInFlowReducer(state, { type: 'SUBMIT_EMAIL' })).toBe(state);
  });

  it('moves to submittingMagicLink on a valid SUBMIT_EMAIL', () => {
    const state: SignInFlowState = {
      status: 'needsSignIn',
      url: 'https://tiktok.com/x',
      email: 'creator@example.com',
      notice: null,
    };
    expect(signInFlowReducer(state, { type: 'SUBMIT_EMAIL' })).toEqual({
      status: 'submittingMagicLink',
      url: 'https://tiktok.com/x',
      email: 'creator@example.com',
    });
  });

  it('moves to checkEmail on MAGIC_LINK_SENT', () => {
    const state: SignInFlowState = { status: 'submittingMagicLink', url: 'https://tiktok.com/x', email: 'creator@example.com' };
    expect(signInFlowReducer(state, { type: 'MAGIC_LINK_SENT' })).toEqual({
      status: 'checkEmail',
      url: 'https://tiktok.com/x',
      email: 'creator@example.com',
    });
  });

  it('moves to magicLinkError preserving the email on MAGIC_LINK_FAILED', () => {
    const state: SignInFlowState = { status: 'submittingMagicLink', url: 'https://tiktok.com/x', email: 'creator@example.com' };
    expect(signInFlowReducer(state, { type: 'MAGIC_LINK_FAILED', error: 'boom' })).toEqual({
      status: 'magicLinkError',
      url: 'https://tiktok.com/x',
      email: 'creator@example.com',
      error: 'boom',
    });
  });

  it('re-enters submittingMagicLink on RESEND_EMAIL from checkEmail', () => {
    const state: SignInFlowState = { status: 'checkEmail', url: 'https://tiktok.com/x', email: 'creator@example.com' };
    expect(signInFlowReducer(state, { type: 'RESEND_EMAIL' })).toEqual({
      status: 'submittingMagicLink',
      url: 'https://tiktok.com/x',
      email: 'creator@example.com',
    });
  });

  it('returns to needsSignIn with notice cleared and email preserved on RETRY_EMAIL from checkEmail', () => {
    const state: SignInFlowState = { status: 'checkEmail', url: 'https://tiktok.com/x', email: 'creator@gmial.com' };
    expect(signInFlowReducer(state, { type: 'RETRY_EMAIL' })).toEqual({
      status: 'needsSignIn',
      url: 'https://tiktok.com/x',
      email: 'creator@gmial.com',
      notice: null,
    });
  });

  it('ignores RETRY_EMAIL from any other state (impossible-state guard)', () => {
    const state: SignInFlowState = {
      status: 'magicLinkError',
      url: 'https://tiktok.com/x',
      email: 'creator@example.com',
      error: 'boom',
    };
    expect(signInFlowReducer(state, { type: 'RETRY_EMAIL' })).toBe(state);
  });
});

describe('isValidEmailFormat', () => {
  it('accepts a plausible email', () => {
    expect(isValidEmailFormat('creator@example.com')).toBe(true);
  });

  it('rejects a string with no @ or domain', () => {
    expect(isValidEmailFormat('not-an-email')).toBe(false);
  });
});

describe('isValidUrlFormat', () => {
  it('accepts any non-empty string', () => {
    expect(isValidUrlFormat('https://tiktok.com/x')).toBe(true);
  });

  it('rejects an empty or whitespace-only string', () => {
    expect(isValidUrlFormat('   ')).toBe(false);
  });
});
