import { isValidEmailFormat } from '@/lib/auth/sign-in-flow-state';

export type StrategyPageState =
  | { status: 'loading' }
  | { status: 'idle'; url: string }
  | { status: 'submitting'; url: string; stillWorking: boolean }
  | { status: 'submitFailed'; url: string; error: string }
  | { status: 'redirecting'; id: string }
  | { status: 'requiresUpgrade' }
  | { status: 'needsSignIn'; email: string; notice: string | null }
  | { status: 'submittingMagicLink'; email: string }
  | { status: 'checkEmail'; email: string }
  | { status: 'magicLinkError'; email: string; error: string };

export type StrategyPageEvent =
  | { type: 'BOOTSTRAPPED' }
  | { type: 'BOOTSTRAP_FAILED' }
  | { type: 'BOOTSTRAP_UNAUTHORIZED' }
  | { type: 'BOOTSTRAP_PAYMENT_REQUIRED' }
  | { type: 'URL_CHANGED'; value: string }
  | { type: 'SUBMIT' }
  | { type: 'SUBMIT_STILL_WORKING' }
  | { type: 'SUBMIT_SUCCESS'; id: string }
  | { type: 'SUBMIT_FAILED'; error: string }
  | { type: 'EMAIL_CHANGED'; email: string }
  | { type: 'SUBMIT_EMAIL' }
  | { type: 'MAGIC_LINK_SENT' }
  | { type: 'MAGIC_LINK_FAILED'; error: string }
  | { type: 'RESEND_EMAIL' }
  | { type: 'RETRY_EMAIL' };

export function createInitialStrategyPageState(): StrategyPageState {
  return { status: 'loading' };
}

export function strategyPageReducer(state: StrategyPageState, event: StrategyPageEvent): StrategyPageState {
  switch (event.type) {
    case 'BOOTSTRAPPED':
      return { status: 'idle', url: '' };

    case 'BOOTSTRAP_FAILED':
      return { status: 'idle', url: '' };

    case 'BOOTSTRAP_UNAUTHORIZED':
      return { status: 'needsSignIn', email: '', notice: null };

    case 'BOOTSTRAP_PAYMENT_REQUIRED':
      return { status: 'requiresUpgrade' };

    case 'URL_CHANGED':
      return state.status === 'idle' || state.status === 'submitFailed' ? { status: 'idle', url: event.value } : state;

    case 'SUBMIT':
      return state.status === 'idle' || state.status === 'submitFailed'
        ? { status: 'submitting', url: state.url, stillWorking: false }
        : state;

    case 'SUBMIT_STILL_WORKING':
      return state.status === 'submitting' ? { ...state, stillWorking: true } : state;

    case 'SUBMIT_SUCCESS':
      return state.status === 'submitting' ? { status: 'redirecting', id: event.id } : state;

    case 'SUBMIT_FAILED':
      return state.status === 'submitting' ? { status: 'submitFailed', url: state.url, error: event.error } : state;

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
