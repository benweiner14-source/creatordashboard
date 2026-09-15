import { isValidEmailFormat } from '@/lib/auth/sign-in-flow-state';
import type { WarroomAlertRow } from './types';

export type WarroomPageState =
  | { status: 'loading' }
  | { status: 'bootstrapFailed' }
  | { status: 'requiresUpgrade' }
  | { status: 'loaded'; alerts: WarroomAlertRow[]; emailOptIn: boolean; optInError: string | null }
  | { status: 'needsSignIn'; email: string; notice: string | null }
  | { status: 'submittingMagicLink'; email: string }
  | { status: 'checkEmail'; email: string }
  | { status: 'magicLinkError'; email: string; error: string };

export type WarroomPageEvent =
  | { type: 'BOOTSTRAPPED'; alerts: WarroomAlertRow[]; emailOptIn: boolean }
  | { type: 'BOOTSTRAP_FAILED' }
  | { type: 'BOOTSTRAP_UNAUTHORIZED' }
  | { type: 'BOOTSTRAP_PAYMENT_REQUIRED' }
  | { type: 'OPT_IN_TOGGLED'; optIn: boolean }
  | { type: 'OPT_IN_SAVE_FAILED'; previousValue: boolean; error: string }
  | { type: 'EMAIL_CHANGED'; email: string }
  | { type: 'SUBMIT_EMAIL' }
  | { type: 'MAGIC_LINK_SENT' }
  | { type: 'MAGIC_LINK_FAILED'; error: string }
  | { type: 'RESEND_EMAIL' }
  | { type: 'RETRY_EMAIL' };

export function createInitialWarroomPageState(): WarroomPageState {
  return { status: 'loading' };
}

export function warroomPageReducer(state: WarroomPageState, event: WarroomPageEvent): WarroomPageState {
  switch (event.type) {
    case 'BOOTSTRAPPED':
      return { status: 'loaded', alerts: event.alerts, emailOptIn: event.emailOptIn, optInError: null };

    case 'BOOTSTRAP_FAILED':
      return { status: 'bootstrapFailed' };

    case 'BOOTSTRAP_UNAUTHORIZED':
      return { status: 'needsSignIn', email: '', notice: null };

    case 'BOOTSTRAP_PAYMENT_REQUIRED':
      return { status: 'requiresUpgrade' };

    case 'OPT_IN_TOGGLED':
      return state.status === 'loaded' ? { ...state, emailOptIn: event.optIn, optInError: null } : state;

    case 'OPT_IN_SAVE_FAILED':
      return state.status === 'loaded' ? { ...state, emailOptIn: event.previousValue, optInError: event.error } : state;

    case 'EMAIL_CHANGED':
      return state.status === 'needsSignIn' || state.status === 'magicLinkError' ? { ...state, email: event.email } : state;

    case 'SUBMIT_EMAIL':
      if (state.status !== 'needsSignIn' && state.status !== 'magicLinkError') return state;
      if (!isValidEmailFormat(state.email)) return state;
      return { status: 'submittingMagicLink', email: state.email };

    case 'MAGIC_LINK_SENT':
      return state.status === 'submittingMagicLink' ? { status: 'checkEmail', email: state.email } : state;

    case 'MAGIC_LINK_FAILED':
      return state.status === 'submittingMagicLink' ? { status: 'magicLinkError', email: state.email, error: event.error } : state;

    case 'RESEND_EMAIL':
      return state.status === 'checkEmail' ? { status: 'submittingMagicLink', email: state.email } : state;

    case 'RETRY_EMAIL':
      return state.status === 'checkEmail' ? { status: 'needsSignIn', email: state.email, notice: null } : state;

    default:
      return state;
  }
}
