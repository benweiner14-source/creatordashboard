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
