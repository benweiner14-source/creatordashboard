export type SignInFlowState =
  | { status: 'idle'; url: string; error: string | null }
  | { status: 'submittingDiagnostic'; url: string; stillWorking: boolean }
  | { status: 'needsSignIn'; url: string; email: string; notice: string | null }
  | { status: 'submittingMagicLink'; url: string; email: string }
  | { status: 'checkEmail'; url: string; email: string }
  | { status: 'magicLinkError'; url: string; email: string; error: string }
  | { status: 'diagnosticError'; url: string; error: string }
  | { status: 'redirectingToReport'; url: string; diagnosticId: string };

export type SignInFlowEvent =
  | { type: 'URL_CHANGED'; url: string }
  | { type: 'SUBMIT_DIAGNOSTIC' }
  | { type: 'DIAGNOSTIC_STILL_WORKING' }
  | { type: 'DIAGNOSTIC_SUCCESS'; diagnosticId: string }
  | { type: 'DIAGNOSTIC_UNAUTHORIZED' }
  | { type: 'DIAGNOSTIC_FAILED'; error: string }
  | { type: 'RETRY_DIAGNOSTIC' }
  | { type: 'EDIT_URL' }
  | { type: 'EMAIL_CHANGED'; email: string }
  | { type: 'SUBMIT_EMAIL' }
  | { type: 'MAGIC_LINK_SENT' }
  | { type: 'MAGIC_LINK_FAILED'; error: string }
  | { type: 'RESEND_EMAIL' }
  | { type: 'RETRY_EMAIL' };

export function isValidEmailFormat(email: string): boolean {
  return /\S+@\S+\.\S+/.test(email);
}

export function isValidUrlFormat(url: string): boolean {
  return url.trim().length > 0;
}

export function createInitialSignInFlowState(params: { url?: string; authError?: string } = {}): SignInFlowState {
  const url = params.url ?? '';
  if (params.authError === 'expired' && url) {
    return {
      status: 'needsSignIn',
      url,
      email: '',
      notice: 'That sign-in link expired or was already used. Enter your email again to get a new one.',
    };
  }
  return { status: 'idle', url, error: null };
}

export function signInFlowReducer(state: SignInFlowState, event: SignInFlowEvent): SignInFlowState {
  switch (event.type) {
    case 'URL_CHANGED':
      return state.status === 'idle' || state.status === 'diagnosticError'
        ? { ...state, url: event.url }
        : state;

    case 'SUBMIT_DIAGNOSTIC':
      if (state.status !== 'idle' && state.status !== 'diagnosticError') return state;
      if (!isValidUrlFormat(state.url)) return state;
      return { status: 'submittingDiagnostic', url: state.url, stillWorking: false };

    case 'DIAGNOSTIC_STILL_WORKING':
      return state.status === 'submittingDiagnostic' ? { ...state, stillWorking: true } : state;

    case 'DIAGNOSTIC_SUCCESS':
      return state.status === 'submittingDiagnostic'
        ? { status: 'redirectingToReport', url: state.url, diagnosticId: event.diagnosticId }
        : state;

    case 'DIAGNOSTIC_UNAUTHORIZED':
      return state.status === 'submittingDiagnostic'
        ? { status: 'needsSignIn', url: state.url, email: '', notice: null }
        : state;

    case 'DIAGNOSTIC_FAILED':
      return state.status === 'submittingDiagnostic'
        ? { status: 'diagnosticError', url: state.url, error: event.error }
        : state;

    case 'RETRY_DIAGNOSTIC':
      return state.status === 'diagnosticError' ? { status: 'idle', url: state.url, error: null } : state;

    case 'EDIT_URL':
      return state.status === 'needsSignIn' || state.status === 'magicLinkError'
        ? { status: 'idle', url: state.url, error: null }
        : state;

    case 'EMAIL_CHANGED':
      return state.status === 'needsSignIn' || state.status === 'magicLinkError'
        ? { ...state, email: event.email }
        : state;

    case 'SUBMIT_EMAIL':
      if (state.status !== 'needsSignIn' && state.status !== 'magicLinkError') return state;
      if (!isValidEmailFormat(state.email)) return state;
      return { status: 'submittingMagicLink', url: state.url, email: state.email };

    case 'MAGIC_LINK_SENT':
      return state.status === 'submittingMagicLink'
        ? { status: 'checkEmail', url: state.url, email: state.email }
        : state;

    case 'MAGIC_LINK_FAILED':
      return state.status === 'submittingMagicLink'
        ? { status: 'magicLinkError', url: state.url, email: state.email, error: event.error }
        : state;

    case 'RESEND_EMAIL':
      return state.status === 'checkEmail'
        ? { status: 'submittingMagicLink', url: state.url, email: state.email }
        : state;

    case 'RETRY_EMAIL':
      return state.status === 'magicLinkError'
        ? { status: 'needsSignIn', url: state.url, email: state.email, notice: null }
        : state;

    default:
      return state;
  }
}
