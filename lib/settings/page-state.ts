import { isValidEmailFormat } from '@/lib/auth/sign-in-flow-state';

export interface SettingsData {
  email: string;
}

export type SettingsPageState =
  | { status: 'loading' }
  | { status: 'bootstrapFailed' }
  | { status: 'loaded'; data: SettingsData }
  // Sign-in sub-flow, mirroring lib/home/page-state.ts so the same
  // <SignInPrompt> component drives it.
  | { status: 'needsSignIn'; email: string; notice: string | null }
  | { status: 'submittingMagicLink'; email: string }
  | { status: 'checkEmail'; email: string }
  | { status: 'magicLinkError'; email: string; error: string };

export type SettingsPageEvent =
  | { type: 'BOOTSTRAPPED'; data: SettingsData }
  | { type: 'BOOTSTRAP_FAILED' }
  | { type: 'BOOTSTRAP_UNAUTHORIZED' }
  | { type: 'EMAIL_CHANGED'; email: string }
  | { type: 'SUBMIT_EMAIL' }
  | { type: 'MAGIC_LINK_SENT' }
  | { type: 'MAGIC_LINK_FAILED'; error: string }
  | { type: 'RESEND_EMAIL' }
  | { type: 'RETRY_EMAIL' };

export function createInitialSettingsPageState(): SettingsPageState {
  return { status: 'loading' };
}

export function settingsPageReducer(state: SettingsPageState, event: SettingsPageEvent): SettingsPageState {
  switch (event.type) {
    case 'BOOTSTRAPPED':
      return { status: 'loaded', data: event.data };

    case 'BOOTSTRAP_FAILED':
      return { status: 'bootstrapFailed' };

    case 'BOOTSTRAP_UNAUTHORIZED':
      return { status: 'needsSignIn', email: '', notice: null };

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
