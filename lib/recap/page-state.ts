import type { RecapPlatform } from './types';

export type RecapHandleInputs = Record<RecapPlatform, string>;

export const EMPTY_HANDLE_INPUTS: RecapHandleInputs = { youtube: '', tiktok: '', instagram: '' };

export type RecapPageState =
  | { status: 'loading' }
  | { status: 'noHandlesConnected'; handles: RecapHandleInputs; error: string | null }
  | { status: 'readyToGenerate'; handles: RecapHandleInputs }
  | { status: 'generating'; handles: RecapHandleInputs; stillWorking: boolean }
  | { status: 'redirectingToCard'; recapCardId: string }
  | { status: 'generationFailed'; handles: RecapHandleInputs; error: string };

export type RecapPageEvent =
  | { type: 'BOOTSTRAPPED'; handles: RecapHandleInputs; recapCardId: string | null }
  | { type: 'BOOTSTRAP_FAILED' }
  | { type: 'HANDLE_CHANGED'; platform: RecapPlatform; value: string }
  | { type: 'HANDLES_SAVED' }
  | { type: 'HANDLES_SAVE_FAILED'; error: string }
  | { type: 'GENERATE' }
  | { type: 'GENERATE_STILL_WORKING' }
  | { type: 'GENERATE_SUCCESS'; recapCardId: string }
  | { type: 'GENERATE_FAILED'; error: string };

function hasAnyHandle(handles: RecapHandleInputs): boolean {
  return Boolean(handles.youtube || handles.tiktok || handles.instagram);
}

export function createInitialRecapPageState(): RecapPageState {
  return { status: 'loading' };
}

export function recapPageReducer(state: RecapPageState, event: RecapPageEvent): RecapPageState {
  switch (event.type) {
    case 'BOOTSTRAPPED':
      if (event.recapCardId) {
        return { status: 'redirectingToCard', recapCardId: event.recapCardId };
      }
      return hasAnyHandle(event.handles)
        ? { status: 'readyToGenerate', handles: event.handles }
        : { status: 'noHandlesConnected', handles: event.handles, error: null };

    case 'BOOTSTRAP_FAILED':
      return {
        status: 'noHandlesConnected',
        handles: EMPTY_HANDLE_INPUTS,
        error: "We couldn't load your recap settings. Please refresh and try again.",
      };

    case 'HANDLE_CHANGED':
      return state.status === 'noHandlesConnected' || state.status === 'readyToGenerate'
        ? { ...state, handles: { ...state.handles, [event.platform]: event.value } }
        : state;

    case 'HANDLES_SAVED':
      return state.status === 'noHandlesConnected' || state.status === 'readyToGenerate'
        ? { status: 'readyToGenerate', handles: state.handles }
        : state;

    case 'HANDLES_SAVE_FAILED':
      return state.status === 'noHandlesConnected' || state.status === 'readyToGenerate'
        ? { status: 'noHandlesConnected', handles: state.handles, error: event.error }
        : state;

    case 'GENERATE':
      return state.status === 'readyToGenerate' || state.status === 'generationFailed'
        ? { status: 'generating', handles: state.handles, stillWorking: false }
        : state;

    case 'GENERATE_STILL_WORKING':
      return state.status === 'generating' ? { ...state, stillWorking: true } : state;

    case 'GENERATE_SUCCESS':
      return state.status === 'generating' ? { status: 'redirectingToCard', recapCardId: event.recapCardId } : state;

    case 'GENERATE_FAILED':
      return state.status === 'generating' ? { status: 'generationFailed', handles: state.handles, error: event.error } : state;

    default:
      return state;
  }
}
