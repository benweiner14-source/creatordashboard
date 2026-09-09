import { isValidEmailFormat } from '@/lib/auth/sign-in-flow-state';

export interface LinkedInStrategyData {
  id: string;
  niche: string;
  targetGoal: string;
  contentPillars: string[];
  postingCadenceRecommendation: string;
  positioningNotes: string;
  headline: string;
  createdAt: string;
}

export interface LinkedInStrategyHistoryItem {
  id: string;
  niche: string;
  targetGoal: string;
  headline: string;
  createdAt: string;
}

export type LinkedInPageState =
  | { status: 'loading' }
  | { status: 'onboarding'; prefillNiche: string; prefillTargetGoal: string; history: LinkedInStrategyHistoryItem[] }
  | { status: 'generating'; niche: string; targetGoal: string; stillWorking: boolean; history: LinkedInStrategyHistoryItem[] }
  | { status: 'generationFailed'; niche: string; targetGoal: string; error: string; history: LinkedInStrategyHistoryItem[] }
  | { status: 'strategyReady'; strategy: LinkedInStrategyData; history: LinkedInStrategyHistoryItem[] }
  | { status: 'requiresUpgrade' }
  | { status: 'needsSignIn'; email: string; notice: string | null }
  | { status: 'submittingMagicLink'; email: string }
  | { status: 'checkEmail'; email: string }
  | { status: 'magicLinkError'; email: string; error: string };

export type LinkedInPageEvent =
  | { type: 'BOOTSTRAPPED'; strategy: LinkedInStrategyData | null; history: LinkedInStrategyHistoryItem[] }
  | { type: 'BOOTSTRAP_FAILED' }
  | { type: 'BOOTSTRAP_UNAUTHORIZED' }
  | { type: 'BOOTSTRAP_PAYMENT_REQUIRED' }
  | { type: 'GENERATE'; niche: string; targetGoal: string }
  | { type: 'GENERATE_STILL_WORKING' }
  | { type: 'GENERATE_SUCCESS'; strategy: LinkedInStrategyData }
  | { type: 'GENERATE_FAILED'; error: string }
  | { type: 'EDIT_STRATEGY_INPUTS' }
  | { type: 'EMAIL_CHANGED'; email: string }
  | { type: 'SUBMIT_EMAIL' }
  | { type: 'MAGIC_LINK_SENT' }
  | { type: 'MAGIC_LINK_FAILED'; error: string }
  | { type: 'RESEND_EMAIL' }
  | { type: 'RETRY_EMAIL' };

export function createInitialLinkedInPageState(): LinkedInPageState {
  return { status: 'loading' };
}

export function linkedInPageReducer(state: LinkedInPageState, event: LinkedInPageEvent): LinkedInPageState {
  switch (event.type) {
    case 'BOOTSTRAPPED':
      return event.strategy
        ? { status: 'strategyReady', strategy: event.strategy, history: event.history }
        : { status: 'onboarding', prefillNiche: '', prefillTargetGoal: '', history: event.history };

    case 'BOOTSTRAP_FAILED':
      return { status: 'onboarding', prefillNiche: '', prefillTargetGoal: '', history: [] };

    case 'BOOTSTRAP_UNAUTHORIZED':
      return { status: 'needsSignIn', email: '', notice: null };

    case 'BOOTSTRAP_PAYMENT_REQUIRED':
      return { status: 'requiresUpgrade' };

    case 'GENERATE': {
      if (state.status !== 'onboarding' && state.status !== 'generationFailed') return state;
      const niche = event.niche.trim();
      const targetGoal = event.targetGoal.trim();
      if (!niche || !targetGoal) return state;
      return { status: 'generating', niche, targetGoal, stillWorking: false, history: state.history };
    }

    case 'GENERATE_STILL_WORKING':
      return state.status === 'generating' ? { ...state, stillWorking: true } : state;

    case 'GENERATE_SUCCESS':
      if (state.status !== 'generating') return state;
      return {
        status: 'strategyReady',
        strategy: event.strategy,
        history: [
          {
            id: event.strategy.id,
            niche: event.strategy.niche,
            targetGoal: event.strategy.targetGoal,
            headline: event.strategy.headline,
            createdAt: event.strategy.createdAt,
          },
          ...state.history,
        ],
      };

    case 'GENERATE_FAILED':
      return state.status === 'generating'
        ? { status: 'generationFailed', niche: state.niche, targetGoal: state.targetGoal, error: event.error, history: state.history }
        : state;

    case 'EDIT_STRATEGY_INPUTS':
      return state.status === 'strategyReady'
        ? { status: 'onboarding', prefillNiche: state.strategy.niche, prefillTargetGoal: state.strategy.targetGoal, history: state.history }
        : state;

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
