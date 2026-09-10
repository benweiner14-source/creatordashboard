import { isValidEmailFormat } from '@/lib/auth/sign-in-flow-state';
import { WATCHLIST_ENTRY_LIMIT, type WatchlistEntryView } from './types';

export { WATCHLIST_ENTRY_LIMIT };

export type WatchlistPageState =
  | { status: 'loading' }
  | { status: 'needsSignIn'; email: string; notice: string | null }
  | { status: 'submittingMagicLink'; email: string }
  | { status: 'checkEmail'; email: string }
  | { status: 'magicLinkError'; email: string; error: string }
  | {
      status: 'loaded';
      entries: WatchlistEntryView[];
      subscriptionRequired: boolean;
      addUrl: string;
      addLabel: string;
      adding: boolean;
      addStillWorking: boolean;
      addError: string | null;
      removingEntryId: string | null;
      removeError: string | null;
    };

export type WatchlistPageEvent =
  | { type: 'BOOTSTRAPPED'; entries: WatchlistEntryView[]; subscriptionRequired: boolean }
  | { type: 'BOOTSTRAP_UNAUTHORIZED' }
  | { type: 'BOOTSTRAP_FAILED' }
  | { type: 'ADD_URL_CHANGED'; value: string }
  | { type: 'ADD_LABEL_CHANGED'; value: string }
  | { type: 'ADD_SUBMIT' }
  | { type: 'ADD_STILL_WORKING' }
  | { type: 'ADD_SUCCESS'; entries: WatchlistEntryView[]; subscriptionRequired: boolean }
  | { type: 'ADD_FAILED'; error: string }
  | { type: 'REMOVE_REQUESTED'; entryId: string }
  | { type: 'REMOVE_SUCCESS'; entryId: string }
  | { type: 'REMOVE_FAILED'; error: string }
  | { type: 'EMAIL_CHANGED'; email: string }
  | { type: 'SUBMIT_EMAIL' }
  | { type: 'MAGIC_LINK_SENT' }
  | { type: 'MAGIC_LINK_FAILED'; error: string }
  | { type: 'RESEND_EMAIL' }
  | { type: 'RETRY_EMAIL' };

export function createInitialWatchlistPageState(): WatchlistPageState {
  return { status: 'loading' };
}

export function watchlistPageReducer(state: WatchlistPageState, event: WatchlistPageEvent): WatchlistPageState {
  switch (event.type) {
    case 'BOOTSTRAPPED':
      return {
        status: 'loaded',
        entries: event.entries,
        subscriptionRequired: event.subscriptionRequired,
        addUrl: '',
        addLabel: '',
        adding: false,
        addStillWorking: false,
        addError: null,
        removingEntryId: null,
        removeError: null,
      };

    case 'BOOTSTRAP_FAILED':
      return {
        status: 'loaded',
        entries: [],
        subscriptionRequired: false,
        addUrl: '',
        addLabel: '',
        adding: false,
        addStillWorking: false,
        addError: null,
        removingEntryId: null,
        removeError: null,
      };

    case 'BOOTSTRAP_UNAUTHORIZED':
      return { status: 'needsSignIn', email: '', notice: null };

    case 'ADD_URL_CHANGED':
      return state.status === 'loaded' && !state.adding ? { ...state, addUrl: event.value } : state;

    case 'ADD_LABEL_CHANGED':
      return state.status === 'loaded' && !state.adding ? { ...state, addLabel: event.value } : state;

    case 'ADD_SUBMIT':
      return state.status === 'loaded' && !state.adding
        ? { ...state, adding: true, addStillWorking: false, addError: null }
        : state;

    case 'ADD_STILL_WORKING':
      return state.status === 'loaded' && state.adding ? { ...state, addStillWorking: true } : state;

    case 'ADD_SUCCESS':
      return state.status === 'loaded'
        ? {
            ...state,
            entries: event.entries,
            subscriptionRequired: event.subscriptionRequired,
            addUrl: '',
            addLabel: '',
            adding: false,
            addStillWorking: false,
            addError: null,
          }
        : state;

    case 'ADD_FAILED':
      return state.status === 'loaded' ? { ...state, adding: false, addStillWorking: false, addError: event.error } : state;

    case 'REMOVE_REQUESTED':
      return state.status === 'loaded' && !state.removingEntryId
        ? { ...state, removingEntryId: event.entryId, removeError: null }
        : state;

    case 'REMOVE_SUCCESS':
      return state.status === 'loaded'
        ? { ...state, entries: state.entries.filter((e) => e.id !== event.entryId), removingEntryId: null }
        : state;

    case 'REMOVE_FAILED':
      return state.status === 'loaded' ? { ...state, removingEntryId: null, removeError: event.error } : state;

    case 'EMAIL_CHANGED':
      return state.status === 'needsSignIn' || state.status === 'magicLinkError' ? { ...state, email: event.email } : state;

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
