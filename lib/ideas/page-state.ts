import { isValidEmailFormat } from '@/lib/auth/sign-in-flow-state';
import type { ContentIdea } from '@/lib/integrations/claude-ideas';

export type IdeasPageState =
  | { status: 'loading' }
  | { status: 'needsNiche'; niche: string; error: string | null; digestEmailOptIn: boolean; digestOptInError: string | null }
  | { status: 'readyToGenerate'; niche: string; digestEmailOptIn: boolean; digestOptInError: string | null }
  | {
      status: 'generating';
      niche: string;
      stillWorking: boolean;
      digestEmailOptIn: boolean;
      digestOptInError: string | null;
    }
  | {
      status: 'ideasReady';
      niche: string;
      ideas: ContentIdea[];
      digestEmailOptIn: boolean;
      digestOptInError: string | null;
      cached?: boolean;
    }
  | { status: 'generationFailed'; niche: string; error: string; digestEmailOptIn: boolean; digestOptInError: string | null }
  // Sign-in sub-flow, mirroring lib/recap/page-state.ts so the same
  // <SignInPrompt> component drives it.
  | { status: 'needsSignIn'; email: string; notice: string | null }
  | { status: 'submittingMagicLink'; email: string }
  | { status: 'checkEmail'; email: string }
  | { status: 'magicLinkError'; email: string; error: string };

export type IdeasPageEvent =
  | { type: 'BOOTSTRAPPED'; niche: string; ideas: ContentIdea[] | null; digestEmailOptIn: boolean }
  | { type: 'BOOTSTRAP_FAILED' }
  | { type: 'BOOTSTRAP_UNAUTHORIZED' }
  | { type: 'NICHE_CHANGED'; value: string }
  | { type: 'NICHE_SAVED' }
  | { type: 'NICHE_SAVE_FAILED'; error: string }
  | { type: 'GENERATE' }
  | { type: 'GENERATE_STILL_WORKING' }
  | { type: 'GENERATE_SUCCESS'; ideas: ContentIdea[]; cached?: boolean }
  | { type: 'GENERATE_FAILED'; error: string }
  | { type: 'EDIT_NICHE' }
  | { type: 'DIGEST_OPT_IN_TOGGLED'; optIn: boolean }
  | { type: 'DIGEST_OPT_IN_SAVE_FAILED'; previousValue: boolean; error: string }
  | { type: 'EMAIL_CHANGED'; email: string }
  | { type: 'SUBMIT_EMAIL' }
  | { type: 'MAGIC_LINK_SENT' }
  | { type: 'MAGIC_LINK_FAILED'; error: string }
  | { type: 'RESEND_EMAIL' }
  | { type: 'RETRY_EMAIL' };

const NICHE_EDITING_STATUSES = ['needsNiche', 'readyToGenerate', 'generationFailed'] as const;
type NicheEditingStatus = (typeof NICHE_EDITING_STATUSES)[number];

export function isNicheEditingState(state: IdeasPageState): state is Extract<IdeasPageState, { status: NicheEditingStatus }> {
  return (NICHE_EDITING_STATUSES as readonly string[]).includes(state.status);
}

const DIGEST_TOGGLE_STATUSES = ['needsNiche', 'readyToGenerate', 'generating', 'ideasReady', 'generationFailed'] as const;
type DigestToggleStatus = (typeof DIGEST_TOGGLE_STATUSES)[number];

/** True for every status that carries digestEmailOptIn — i.e. everywhere except loading and the sign-in sub-flow. */
export function hasDigestOptInState(state: IdeasPageState): state is Extract<IdeasPageState, { status: DigestToggleStatus }> {
  return (DIGEST_TOGGLE_STATUSES as readonly string[]).includes(state.status);
}

export function createInitialIdeasPageState(): IdeasPageState {
  return { status: 'loading' };
}

export function ideasPageReducer(state: IdeasPageState, event: IdeasPageEvent): IdeasPageState {
  switch (event.type) {
    case 'BOOTSTRAPPED':
      if (event.ideas) {
        return {
          status: 'ideasReady',
          niche: event.niche,
          ideas: event.ideas,
          digestEmailOptIn: event.digestEmailOptIn,
          digestOptInError: null,
        };
      }
      return event.niche
        ? { status: 'readyToGenerate', niche: event.niche, digestEmailOptIn: event.digestEmailOptIn, digestOptInError: null }
        : { status: 'needsNiche', niche: '', error: null, digestEmailOptIn: event.digestEmailOptIn, digestOptInError: null };

    case 'BOOTSTRAP_FAILED':
      return {
        status: 'needsNiche',
        niche: '',
        error: "We couldn't load your content ideas settings. Please refresh and try again.",
        digestEmailOptIn: false,
        digestOptInError: null,
      };

    case 'BOOTSTRAP_UNAUTHORIZED':
      return { status: 'needsSignIn', email: '', notice: null };

    case 'NICHE_CHANGED':
      return isNicheEditingState(state) ? { ...state, niche: event.value } : state;

    case 'NICHE_SAVED':
      if (!isNicheEditingState(state)) return state;
      return state.niche.trim()
        ? {
            status: 'readyToGenerate',
            niche: state.niche,
            digestEmailOptIn: state.digestEmailOptIn,
            digestOptInError: state.digestOptInError,
          }
        : {
            status: 'needsNiche',
            niche: state.niche,
            error: null,
            digestEmailOptIn: state.digestEmailOptIn,
            digestOptInError: state.digestOptInError,
          };

    case 'NICHE_SAVE_FAILED':
      return isNicheEditingState(state)
        ? {
            status: 'needsNiche',
            niche: state.niche,
            error: event.error,
            digestEmailOptIn: state.digestEmailOptIn,
            digestOptInError: state.digestOptInError,
          }
        : state;

    case 'GENERATE':
      return state.status === 'readyToGenerate' || state.status === 'generationFailed'
        ? {
            status: 'generating',
            niche: state.niche,
            stillWorking: false,
            digestEmailOptIn: state.digestEmailOptIn,
            digestOptInError: state.digestOptInError,
          }
        : state;

    case 'GENERATE_STILL_WORKING':
      return state.status === 'generating' ? { ...state, stillWorking: true } : state;

    case 'GENERATE_SUCCESS':
      return state.status === 'generating'
        ? {
            status: 'ideasReady',
            niche: state.niche,
            ideas: event.ideas,
            digestEmailOptIn: state.digestEmailOptIn,
            digestOptInError: state.digestOptInError,
            ...(event.cached ? { cached: true } : {}),
          }
        : state;

    case 'GENERATE_FAILED':
      return state.status === 'generating'
        ? {
            status: 'generationFailed',
            niche: state.niche,
            error: event.error,
            digestEmailOptIn: state.digestEmailOptIn,
            digestOptInError: state.digestOptInError,
          }
        : state;

    case 'EDIT_NICHE':
      return state.status === 'ideasReady'
        ? {
            status: 'readyToGenerate',
            niche: state.niche,
            digestEmailOptIn: state.digestEmailOptIn,
            digestOptInError: state.digestOptInError,
          }
        : state;

    case 'DIGEST_OPT_IN_TOGGLED':
      return hasDigestOptInState(state) ? { ...state, digestEmailOptIn: event.optIn, digestOptInError: null } : state;

    case 'DIGEST_OPT_IN_SAVE_FAILED':
      return hasDigestOptInState(state)
        ? { ...state, digestEmailOptIn: event.previousValue, digestOptInError: event.error }
        : state;

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
