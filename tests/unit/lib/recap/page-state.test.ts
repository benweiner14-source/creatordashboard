import { describe, it, expect } from 'vitest';
import {
  recapPageReducer,
  createInitialRecapPageState,
  EMPTY_HANDLE_INPUTS,
  type RecapPageState,
} from '@/lib/recap/page-state';

describe('createInitialRecapPageState', () => {
  it('starts in loading', () => {
    expect(createInitialRecapPageState()).toEqual({ status: 'loading' });
  });
});

describe('recapPageReducer — bootstrap', () => {
  it('moves to noHandlesConnected when no handles come back', () => {
    const next = recapPageReducer(
      { status: 'loading' },
      { type: 'BOOTSTRAPPED', handles: EMPTY_HANDLE_INPUTS, recapCardId: null }
    );
    expect(next).toEqual({ status: 'noHandlesConnected', handles: EMPTY_HANDLE_INPUTS, error: null });
  });

  it('moves to readyToGenerate when at least one handle is already connected', () => {
    const handles = { youtube: 'creator', tiktok: '', instagram: '' };
    const next = recapPageReducer({ status: 'loading' }, { type: 'BOOTSTRAPPED', handles, recapCardId: null });
    expect(next).toEqual({ status: 'readyToGenerate', handles });
  });

  it('moves straight to redirectingToCard when this month already has a card', () => {
    const next = recapPageReducer(
      { status: 'loading' },
      { type: 'BOOTSTRAPPED', handles: { youtube: 'creator', tiktok: '', instagram: '' }, recapCardId: 'card-1' }
    );
    expect(next).toEqual({ status: 'redirectingToCard', recapCardId: 'card-1' });
  });

  it('moves to noHandlesConnected with an error on BOOTSTRAP_FAILED', () => {
    const next = recapPageReducer({ status: 'loading' }, { type: 'BOOTSTRAP_FAILED' });
    expect(next).toEqual({
      status: 'noHandlesConnected',
      handles: EMPTY_HANDLE_INPUTS,
      error: "We couldn't load your recap settings. Please refresh and try again.",
    });
  });
});

describe('recapPageReducer — handle editing', () => {
  it('updates one platform field from noHandlesConnected', () => {
    const state: RecapPageState = { status: 'noHandlesConnected', handles: EMPTY_HANDLE_INPUTS, error: null };
    const next = recapPageReducer(state, { type: 'HANDLE_CHANGED', platform: 'tiktok', value: 'creator' });
    expect(next).toEqual({ status: 'noHandlesConnected', handles: { ...EMPTY_HANDLE_INPUTS, tiktok: 'creator' }, error: null });
  });

  it('ignores HANDLE_CHANGED while generating (impossible-state guard)', () => {
    const state: RecapPageState = { status: 'generating', handles: EMPTY_HANDLE_INPUTS, stillWorking: false };
    expect(recapPageReducer(state, { type: 'HANDLE_CHANGED', platform: 'tiktok', value: 'x' })).toBe(state);
  });

  it('moves noHandlesConnected to readyToGenerate on HANDLES_SAVED', () => {
    const handles = { youtube: 'creator', tiktok: '', instagram: '' };
    const state: RecapPageState = { status: 'noHandlesConnected', handles, error: null };
    expect(recapPageReducer(state, { type: 'HANDLES_SAVED' })).toEqual({ status: 'readyToGenerate', handles });
  });

  it('preserves the handles and sets an error on HANDLES_SAVE_FAILED', () => {
    const handles = { youtube: 'not valid!', tiktok: '', instagram: '' };
    const state: RecapPageState = { status: 'noHandlesConnected', handles, error: null };
    const next = recapPageReducer(state, { type: 'HANDLES_SAVE_FAILED', error: 'boom' });
    expect(next).toEqual({ status: 'noHandlesConnected', handles, error: 'boom' });
  });

  it('falls back to noHandlesConnected when a save clears every platform', () => {
    const state: RecapPageState = { status: 'noHandlesConnected', handles: EMPTY_HANDLE_INPUTS, error: 'boom' };
    expect(recapPageReducer(state, { type: 'HANDLES_SAVED' })).toEqual({
      status: 'noHandlesConnected',
      handles: EMPTY_HANDLE_INPUTS,
      error: null,
    });
  });

  it('does not offer Generate after a save that emptied a previously connected platform', () => {
    const state: RecapPageState = { status: 'readyToGenerate', handles: EMPTY_HANDLE_INPUTS };
    expect(recapPageReducer(state, { type: 'HANDLES_SAVED' }).status).toBe('noHandlesConnected');
  });
});

describe('recapPageReducer — handle editing after a failed generation', () => {
  const handles = { youtube: 'creator', tiktok: '', instagram: '' };
  const failed: RecapPageState = { status: 'generationFailed', handles, error: 'boom' };

  it('accepts HANDLE_CHANGED from generationFailed', () => {
    expect(recapPageReducer(failed, { type: 'HANDLE_CHANGED', platform: 'tiktok', value: 'creator2' })).toEqual({
      status: 'generationFailed',
      handles: { ...handles, tiktok: 'creator2' },
      error: 'boom',
    });
  });

  it('moves generationFailed to readyToGenerate on HANDLES_SAVED', () => {
    expect(recapPageReducer(failed, { type: 'HANDLES_SAVED' })).toEqual({ status: 'readyToGenerate', handles });
  });

  it('moves generationFailed to noHandlesConnected with the error on HANDLES_SAVE_FAILED', () => {
    expect(recapPageReducer(failed, { type: 'HANDLES_SAVE_FAILED', error: 'nope' })).toEqual({
      status: 'noHandlesConnected',
      handles,
      error: 'nope',
    });
  });
});

describe('recapPageReducer — sign-in sub-flow', () => {
  it('moves to needsSignIn when the bootstrap request comes back unauthorized', () => {
    expect(recapPageReducer({ status: 'loading' }, { type: 'BOOTSTRAP_UNAUTHORIZED' })).toEqual({
      status: 'needsSignIn',
      email: '',
      notice: null,
    });
  });

  it('collects the email and submits it', () => {
    const typed = recapPageReducer(
      { status: 'needsSignIn', email: '', notice: null },
      { type: 'EMAIL_CHANGED', email: 'creator@example.com' }
    );
    expect(typed).toEqual({ status: 'needsSignIn', email: 'creator@example.com', notice: null });
    expect(recapPageReducer(typed, { type: 'SUBMIT_EMAIL' })).toEqual({
      status: 'submittingMagicLink',
      email: 'creator@example.com',
    });
  });

  it('refuses to submit an email that is not a valid format', () => {
    const state: RecapPageState = { status: 'needsSignIn', email: 'nope', notice: null };
    expect(recapPageReducer(state, { type: 'SUBMIT_EMAIL' })).toBe(state);
  });

  it('moves to checkEmail on MAGIC_LINK_SENT and back to submitting on RESEND_EMAIL', () => {
    const sent = recapPageReducer(
      { status: 'submittingMagicLink', email: 'creator@example.com' },
      { type: 'MAGIC_LINK_SENT' }
    );
    expect(sent).toEqual({ status: 'checkEmail', email: 'creator@example.com' });
    expect(recapPageReducer(sent, { type: 'RESEND_EMAIL' })).toEqual({
      status: 'submittingMagicLink',
      email: 'creator@example.com',
    });
    expect(recapPageReducer(sent, { type: 'RETRY_EMAIL' })).toEqual({
      status: 'needsSignIn',
      email: 'creator@example.com',
      notice: null,
    });
  });

  it('keeps the email on MAGIC_LINK_FAILED so it can be retried', () => {
    expect(
      recapPageReducer({ status: 'submittingMagicLink', email: 'creator@example.com' }, { type: 'MAGIC_LINK_FAILED', error: 'boom' })
    ).toEqual({ status: 'magicLinkError', email: 'creator@example.com', error: 'boom' });
  });
});

describe('recapPageReducer — generation', () => {
  const handles = { youtube: 'creator', tiktok: '', instagram: '' };

  it('moves readyToGenerate to generating on GENERATE', () => {
    const next = recapPageReducer({ status: 'readyToGenerate', handles }, { type: 'GENERATE' });
    expect(next).toEqual({ status: 'generating', handles, stillWorking: false });
  });

  it('also allows GENERATE to retry from generationFailed', () => {
    const state: RecapPageState = { status: 'generationFailed', handles, error: 'boom' };
    expect(recapPageReducer(state, { type: 'GENERATE' })).toEqual({ status: 'generating', handles, stillWorking: false });
  });

  it('sets stillWorking on GENERATE_STILL_WORKING without changing status', () => {
    const state: RecapPageState = { status: 'generating', handles, stillWorking: false };
    expect(recapPageReducer(state, { type: 'GENERATE_STILL_WORKING' })).toEqual({ status: 'generating', handles, stillWorking: true });
  });

  it('moves to redirectingToCard on GENERATE_SUCCESS', () => {
    const state: RecapPageState = { status: 'generating', handles, stillWorking: true };
    expect(recapPageReducer(state, { type: 'GENERATE_SUCCESS', recapCardId: 'card-2' })).toEqual({
      status: 'redirectingToCard',
      recapCardId: 'card-2',
    });
  });

  it('moves to generationFailed preserving the handles on GENERATE_FAILED', () => {
    const state: RecapPageState = { status: 'generating', handles, stillWorking: false };
    expect(recapPageReducer(state, { type: 'GENERATE_FAILED', error: 'boom' })).toEqual({
      status: 'generationFailed',
      handles,
      error: 'boom',
    });
  });

  it('ignores GENERATE from noHandlesConnected (impossible-state guard)', () => {
    const state: RecapPageState = { status: 'noHandlesConnected', handles: EMPTY_HANDLE_INPUTS, error: null };
    expect(recapPageReducer(state, { type: 'GENERATE' })).toBe(state);
  });
});
