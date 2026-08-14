import { describe, it, expect } from 'vitest';
import {
  recapPageReducer,
  createInitialRecapPageState,
  EMPTY_HANDLE_INPUTS,
  hasAnyConnection,
  type RecapPageState,
  type RecapConnectionStatus,
} from '@/lib/recap/page-state';

describe('createInitialRecapPageState', () => {
  it('starts in loading', () => {
    expect(createInitialRecapPageState()).toEqual({ status: 'loading' });
  });
});

describe('recapPageReducer — bootstrap', () => {
  const connections = { tiktok: false, instagram: false };

  it('moves to noHandlesConnected when no handles come back', () => {
    const next = recapPageReducer(
      { status: 'loading' },
      { type: 'BOOTSTRAPPED', handles: EMPTY_HANDLE_INPUTS, connections, recapCardId: null }
    );
    expect(next).toEqual({ status: 'noHandlesConnected', handles: EMPTY_HANDLE_INPUTS, connections, error: null });
  });

  it('moves to readyToGenerate when at least one handle is already connected', () => {
    const handles = { youtube: 'creator', tiktok: '', instagram: '' };
    const next = recapPageReducer({ status: 'loading' }, { type: 'BOOTSTRAPPED', handles, connections, recapCardId: null });
    expect(next).toEqual({ status: 'readyToGenerate', handles, connections });
  });

  it('moves straight to redirectingToCard when this month already has a card', () => {
    const next = recapPageReducer(
      { status: 'loading' },
      {
        type: 'BOOTSTRAPPED',
        handles: { youtube: 'creator', tiktok: '', instagram: '' },
        connections,
        recapCardId: 'card-1',
      }
    );
    expect(next).toEqual({ status: 'redirectingToCard', recapCardId: 'card-1' });
  });

  it('moves to noHandlesConnected with an error on BOOTSTRAP_FAILED', () => {
    const next = recapPageReducer({ status: 'loading' }, { type: 'BOOTSTRAP_FAILED' });
    expect(next).toEqual({
      status: 'noHandlesConnected',
      handles: EMPTY_HANDLE_INPUTS,
      connections,
      error: "We couldn't load your recap settings. Please refresh and try again.",
    });
  });
});

describe('recapPageReducer — handle editing', () => {
  const connections = { tiktok: false, instagram: false };

  it('updates one platform field from noHandlesConnected', () => {
    const state: RecapPageState = { status: 'noHandlesConnected', handles: EMPTY_HANDLE_INPUTS, connections, error: null };
    const next = recapPageReducer(state, { type: 'HANDLE_CHANGED', platform: 'tiktok', value: 'creator' });
    expect(next).toEqual({
      status: 'noHandlesConnected',
      handles: { ...EMPTY_HANDLE_INPUTS, tiktok: 'creator' },
      connections,
      error: null,
    });
  });

  it('ignores HANDLE_CHANGED while generating (impossible-state guard)', () => {
    const state: RecapPageState = { status: 'generating', handles: EMPTY_HANDLE_INPUTS, connections, stillWorking: false };
    expect(recapPageReducer(state, { type: 'HANDLE_CHANGED', platform: 'tiktok', value: 'x' })).toBe(state);
  });

  it('moves noHandlesConnected to readyToGenerate on HANDLES_SAVED', () => {
    const handles = { youtube: 'creator', tiktok: '', instagram: '' };
    const state: RecapPageState = { status: 'noHandlesConnected', handles, connections, error: null };
    expect(recapPageReducer(state, { type: 'HANDLES_SAVED' })).toEqual({ status: 'readyToGenerate', handles, connections });
  });

  it('preserves the handles and sets an error on HANDLES_SAVE_FAILED', () => {
    const handles = { youtube: 'not valid!', tiktok: '', instagram: '' };
    const state: RecapPageState = { status: 'noHandlesConnected', handles, connections, error: null };
    const next = recapPageReducer(state, { type: 'HANDLES_SAVE_FAILED', error: 'boom' });
    expect(next).toEqual({ status: 'noHandlesConnected', handles, connections, error: 'boom' });
  });

  it('falls back to noHandlesConnected when a save clears every platform', () => {
    const state: RecapPageState = { status: 'noHandlesConnected', handles: EMPTY_HANDLE_INPUTS, connections, error: 'boom' };
    expect(recapPageReducer(state, { type: 'HANDLES_SAVED' })).toEqual({
      status: 'noHandlesConnected',
      handles: EMPTY_HANDLE_INPUTS,
      connections,
      error: null,
    });
  });

  it('does not offer Generate after a save that emptied a previously connected platform', () => {
    const state: RecapPageState = { status: 'readyToGenerate', handles: EMPTY_HANDLE_INPUTS, connections };
    expect(recapPageReducer(state, { type: 'HANDLES_SAVED' }).status).toBe('noHandlesConnected');
  });
});

describe('recapPageReducer — handle editing after a failed generation', () => {
  const handles = { youtube: 'creator', tiktok: '', instagram: '' };
  const connections = { tiktok: false, instagram: false };
  const failed: RecapPageState = { status: 'generationFailed', handles, connections, error: 'boom' };

  it('accepts HANDLE_CHANGED from generationFailed', () => {
    expect(recapPageReducer(failed, { type: 'HANDLE_CHANGED', platform: 'tiktok', value: 'creator2' })).toEqual({
      status: 'generationFailed',
      handles: { ...handles, tiktok: 'creator2' },
      connections,
      error: 'boom',
    });
  });

  it('moves generationFailed to readyToGenerate on HANDLES_SAVED', () => {
    expect(recapPageReducer(failed, { type: 'HANDLES_SAVED' })).toEqual({ status: 'readyToGenerate', handles, connections });
  });

  it('moves generationFailed to noHandlesConnected with the error on HANDLES_SAVE_FAILED', () => {
    expect(recapPageReducer(failed, { type: 'HANDLES_SAVE_FAILED', error: 'nope' })).toEqual({
      status: 'noHandlesConnected',
      handles,
      connections,
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
  const connections = { tiktok: false, instagram: false };

  it('moves readyToGenerate to generating on GENERATE', () => {
    const next = recapPageReducer({ status: 'readyToGenerate', handles, connections }, { type: 'GENERATE' });
    expect(next).toEqual({ status: 'generating', handles, connections, stillWorking: false });
  });

  it('also allows GENERATE to retry from generationFailed', () => {
    const state: RecapPageState = { status: 'generationFailed', handles, connections, error: 'boom' };
    expect(recapPageReducer(state, { type: 'GENERATE' })).toEqual({ status: 'generating', handles, connections, stillWorking: false });
  });

  it('sets stillWorking on GENERATE_STILL_WORKING without changing status', () => {
    const state: RecapPageState = { status: 'generating', handles, connections, stillWorking: false };
    expect(recapPageReducer(state, { type: 'GENERATE_STILL_WORKING' })).toEqual({
      status: 'generating',
      handles,
      connections,
      stillWorking: true,
    });
  });

  it('moves to redirectingToCard on GENERATE_SUCCESS', () => {
    const state: RecapPageState = { status: 'generating', handles, connections, stillWorking: true };
    expect(recapPageReducer(state, { type: 'GENERATE_SUCCESS', recapCardId: 'card-2' })).toEqual({
      status: 'redirectingToCard',
      recapCardId: 'card-2',
    });
  });

  it('moves to generationFailed preserving the handles on GENERATE_FAILED', () => {
    const state: RecapPageState = { status: 'generating', handles, connections, stillWorking: false };
    expect(recapPageReducer(state, { type: 'GENERATE_FAILED', error: 'boom' })).toEqual({
      status: 'generationFailed',
      handles,
      connections,
      error: 'boom',
    });
  });

  it('ignores GENERATE from noHandlesConnected (impossible-state guard)', () => {
    const state: RecapPageState = { status: 'noHandlesConnected', handles: EMPTY_HANDLE_INPUTS, connections, error: null };
    expect(recapPageReducer(state, { type: 'GENERATE' })).toBe(state);
  });
});

describe('hasAnyConnection', () => {
  it('is true when at least one platform is connected', () => {
    expect(hasAnyConnection({ tiktok: true, instagram: false })).toBe(true);
  });

  it('is false when no platform is connected', () => {
    expect(hasAnyConnection({ tiktok: false, instagram: false })).toBe(false);
  });
});

describe('recapPageReducer — connections', () => {
  const handles = EMPTY_HANDLE_INPUTS;

  it('BOOTSTRAPPED with a connection but no handles goes to readyToGenerate', () => {
    const next = recapPageReducer(
      { status: 'loading' },
      { type: 'BOOTSTRAPPED', handles, connections: { tiktok: true, instagram: false }, recapCardId: null }
    );
    expect(next).toEqual({ status: 'readyToGenerate', handles, connections: { tiktok: true, instagram: false } });
  });

  it('BOOTSTRAPPED with neither handles nor connections goes to noHandlesConnected', () => {
    const next = recapPageReducer(
      { status: 'loading' },
      { type: 'BOOTSTRAPPED', handles, connections: { tiktok: false, instagram: false }, recapCardId: null }
    );
    expect(next).toEqual({ status: 'noHandlesConnected', handles, connections: { tiktok: false, instagram: false }, error: null });
  });

  it('DISCONNECTED drops that platform from readyToGenerate to noHandlesConnected when nothing else is connected', () => {
    const state: RecapPageState = { status: 'readyToGenerate', handles, connections: { tiktok: true, instagram: false } };
    const next = recapPageReducer(state, { type: 'DISCONNECTED', platform: 'tiktok' });
    expect(next).toEqual({ status: 'noHandlesConnected', handles, connections: { tiktok: false, instagram: false }, error: null });
  });

  it('DISCONNECTED stays readyToGenerate when a handle is still saved for another platform', () => {
    const withHandle = { ...handles, youtube: 'creator' };
    const state: RecapPageState = { status: 'readyToGenerate', handles: withHandle, connections: { tiktok: true, instagram: false } };
    const next = recapPageReducer(state, { type: 'DISCONNECTED', platform: 'tiktok' });
    expect(next).toEqual({ status: 'readyToGenerate', handles: withHandle, connections: { tiktok: false, instagram: false } });
  });

  it('DISCONNECTED is ignored outside a handle-editing state', () => {
    const state: RecapPageState = { status: 'generating', handles, connections: { tiktok: true, instagram: false }, stillWorking: false };
    expect(recapPageReducer(state, { type: 'DISCONNECTED', platform: 'tiktok' })).toBe(state);
  });

  it('DISCONNECT_FAILED surfaces an error while preserving handles and connections', () => {
    const state: RecapPageState = { status: 'readyToGenerate', handles, connections: { tiktok: true, instagram: false } };
    const next = recapPageReducer(state, { type: 'DISCONNECT_FAILED', error: 'boom' });
    expect(next).toEqual({ status: 'noHandlesConnected', handles, connections: { tiktok: true, instagram: false }, error: 'boom' });
  });

  it('DISCONNECT_FAILED is ignored outside a handle-editing state', () => {
    const state: RecapPageState = { status: 'generating', handles, connections: { tiktok: true, instagram: false }, stillWorking: false };
    expect(recapPageReducer(state, { type: 'DISCONNECT_FAILED', error: 'boom' })).toBe(state);
  });
});
