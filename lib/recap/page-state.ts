import { isValidEmailFormat } from '@/lib/auth/sign-in-flow-state';
import type { RecapPlatform } from './types';

export type RecapHandleInputs = Record<RecapPlatform, string>;

export const EMPTY_HANDLE_INPUTS: RecapHandleInputs = { youtube: '', tiktok: '', instagram: '' };

export type RecapPageState =
  | { status: 'loading' }
  | { status: 'noHandlesConnected'; handles: RecapHandleInputs; error: string | null }
  | { status: 'readyToGenerate'; handles: RecapHandleInputs }
  | { status: 'generating'; handles: RecapHandleInputs; stillWorking: boolean }
  | { status: 'redirectingToCard'; recapCardId: string }
  | { status: 'generationFailed'; handles: RecapHandleInputs; error: string }
  // Sign-in sub-flow, mirroring lib/auth/sign-in-flow-state.ts so the same
  // <SignInPrompt> component drives it.
  | { status: 'needsSignIn'; email: string; notice: string | null }
  | { status: 'submittingMagicLink'; email: string }
  | { status: 'checkEmail'; email: string }
  | { status: 'magicLinkError'; email: string; error: string };

export type RecapPageEvent =
  | { type: 'BOOTSTRAPPED'; handles: RecapHandleInputs; recapCardId: string | null }
  | { type: 'BOOTSTRAP_FAILED' }
  | { type: 'BOOTSTRAP_UNAUTHORIZED' }
  | { type: 'HANDLE_CHANGED'; platform: RecapPlatform; value: string }
  | { type: 'HANDLES_SAVED' }
  | { type: 'HANDLES_SAVE_FAILED'; error: string }
  | { type: 'GENERATE' }
  | { type: 'GENERATE_STILL_WORKING' }
  | { type: 'GENERATE_SUCCESS'; recapCardId: string }
  | { type: 'GENERATE_FAILED'; error: string }
  | { type: 'EMAIL_CHANGED'; email: string }
  | { type: 'SUBMIT_EMAIL' }
  | { type: 'MAGIC_LINK_SENT' }
  | { type: 'MAGIC_LINK_FAILED'; error: string }
  | { type: 'RESEND_EMAIL' }
  | { type: 'RETRY_EMAIL' };

export function hasAnyHandle(handles: RecapHandleInputs): boolean {
  return Boolean(handles.youtube || handles.tiktok || handles.instagram);
}

/**
 * The states in which the handle inputs are live: a creator can type into
 * them and save. Generation failing must not freeze the form — fixing a
 * typo or adding a platform is the most likely way out of that failure.
 */
export const HANDLE_EDITING_STATUSES = ['noHandlesConnected', 'readyToGenerate', 'generationFailed'] as const;

export type HandleEditingStatus = (typeof HANDLE_EDITING_STATUSES)[number];

export function isHandleEditingState(
  state: RecapPageState
): state is Extract<RecapPageState, { status: HandleEditingStatus }> {
  return (HANDLE_EDITING_STATUSES as readonly string[]).includes(state.status);
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

    case 'BOOTSTRAP_UNAUTHORIZED':
      return { status: 'needsSignIn', email: '', notice: null };

    case 'HANDLE_CHANGED':
      return isHandleEditingState(state)
        ? { ...state, handles: { ...state.handles, [event.platform]: event.value } }
        : state;

    case 'HANDLES_SAVED':
      if (!isHandleEditingState(state)) return state;
      // A save that clears every platform succeeds server-side but leaves
      // nothing to generate from — don't offer a Generate button that can
      // only 400.
      return hasAnyHandle(state.handles)
        ? { status: 'readyToGenerate', handles: state.handles }
        : { status: 'noHandlesConnected', handles: state.handles, error: null };

    case 'HANDLES_SAVE_FAILED':
      return isHandleEditingState(state)
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

    case 'EMAIL_CHANGED':
      return state.status === 'needsSignIn' || state.status === 'magicLinkError'
        ? { ...state, email: event.email }
        : state;

    case 'SUBMIT_EMAIL':
      if (state.status !== 'needsSignIn' && state.status !== 'magicLinkError') return state;
      if (!isValidEmailFormat(state.email)) return state;
      return { status: 'submittingMagicLink', email: state.email };

    case 'MAGIC_LINK_SENT':
      return state.status === 'submittingMagicLink' ? { status: 'checkEmail', email: state.email } : state;

    case 'MAGIC_LINK_FAILED':
      return state.status === 'submittingMagicLink'
        ? { status: 'magicLinkError', email: state.email, error: event.error }
        : state;

    case 'RESEND_EMAIL':
      return state.status === 'checkEmail' ? { status: 'submittingMagicLink', email: state.email } : state;

    case 'RETRY_EMAIL':
      return state.status === 'checkEmail' ? { status: 'needsSignIn', email: state.email, notice: null } : state;

    default:
      return state;
  }
}
