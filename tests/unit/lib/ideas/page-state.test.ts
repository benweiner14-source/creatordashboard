import { describe, it, expect } from 'vitest';
import {
  ideasPageReducer,
  createInitialIdeasPageState,
  isNicheEditingState,
  hasDigestOptInState,
  type IdeasPageState,
} from '@/lib/ideas/page-state';
import type { ContentIdea } from '@/lib/integrations/claude-ideas';

const IDEA: ContentIdea = {
  workingTitle: 'Sourdough Speedrun',
  pitch: 'Bake a loaf in under 2 hours on camera',
  medium: 'reel',
  format: 'Speed Recap',
  whyItsHotNow: 'Sourdough resurgence trending this week',
  sourceUrl: 'https://example.com/a',
  whyItRanksHere: 'High reach from trend-jacking',
  kpiSignals: ['reach'],
  reelDetails: { suggestedLengthSeconds: 60, style: 'talking-head' },
  carouselDetails: null,
};

describe('createInitialIdeasPageState', () => {
  it('starts in loading', () => {
    expect(createInitialIdeasPageState()).toEqual({ status: 'loading' });
  });
});

describe('ideasPageReducer — bootstrap', () => {
  it('moves to needsNiche when no niche is set', () => {
    const next = ideasPageReducer(
      { status: 'loading' },
      { type: 'BOOTSTRAPPED', niche: '', ideas: null, digestEmailOptIn: false }
    );
    expect(next).toEqual({ status: 'needsNiche', niche: '', error: null, digestEmailOptIn: false, digestOptInError: null });
  });

  it('moves to readyToGenerate when a niche is already set and no digest exists yet', () => {
    const next = ideasPageReducer(
      { status: 'loading' },
      { type: 'BOOTSTRAPPED', niche: 'home baking', ideas: null, digestEmailOptIn: true }
    );
    expect(next).toEqual({ status: 'readyToGenerate', niche: 'home baking', digestEmailOptIn: true, digestOptInError: null });
  });

  it('moves straight to ideasReady when this week already has a digest', () => {
    const next = ideasPageReducer(
      { status: 'loading' },
      { type: 'BOOTSTRAPPED', niche: 'home baking', ideas: [IDEA], digestEmailOptIn: true }
    );
    expect(next).toEqual({
      status: 'ideasReady',
      niche: 'home baking',
      ideas: [IDEA],
      digestEmailOptIn: true,
      digestOptInError: null,
    });
  });

  it('moves to needsNiche with an error on BOOTSTRAP_FAILED', () => {
    const next = ideasPageReducer({ status: 'loading' }, { type: 'BOOTSTRAP_FAILED' });
    expect(next).toEqual({
      status: 'needsNiche',
      niche: '',
      error: "We couldn't load your content ideas settings. Please refresh and try again.",
      digestEmailOptIn: false,
      digestOptInError: null,
    });
  });

  it('moves to needsSignIn on BOOTSTRAP_UNAUTHORIZED', () => {
    const next = ideasPageReducer({ status: 'loading' }, { type: 'BOOTSTRAP_UNAUTHORIZED' });
    expect(next).toEqual({ status: 'needsSignIn', email: '', notice: null });
  });

  it('moves to requiresUpgrade on BOOTSTRAP_PAYMENT_REQUIRED', () => {
    const next = ideasPageReducer({ status: 'loading' }, { type: 'BOOTSTRAP_PAYMENT_REQUIRED' });
    expect(next).toEqual({ status: 'requiresUpgrade' });
  });
});

describe('ideasPageReducer — niche editing', () => {
  it('updates the niche field from needsNiche', () => {
    const state: IdeasPageState = { status: 'needsNiche', niche: '', error: null, digestEmailOptIn: false, digestOptInError: null };
    expect(ideasPageReducer(state, { type: 'NICHE_CHANGED', value: 'home baking' })).toEqual({
      status: 'needsNiche',
      niche: 'home baking',
      error: null,
      digestEmailOptIn: false,
      digestOptInError: null,
    });
  });

  it('ignores NICHE_CHANGED while generating (impossible-state guard)', () => {
    const state: IdeasPageState = {
      status: 'generating',
      niche: 'home baking',
      stillWorking: false,
      digestEmailOptIn: false,
      digestOptInError: null,
    };
    expect(ideasPageReducer(state, { type: 'NICHE_CHANGED', value: 'x' })).toBe(state);
  });

  it('moves needsNiche to readyToGenerate on NICHE_SAVED', () => {
    const state: IdeasPageState = {
      status: 'needsNiche',
      niche: 'home baking',
      error: null,
      digestEmailOptIn: false,
      digestOptInError: null,
    };
    expect(ideasPageReducer(state, { type: 'NICHE_SAVED' })).toEqual({
      status: 'readyToGenerate',
      niche: 'home baking',
      digestEmailOptIn: false,
      digestOptInError: null,
    });
  });

  it('preserves the niche and sets an error on NICHE_SAVE_FAILED', () => {
    const state: IdeasPageState = {
      status: 'needsNiche',
      niche: 'x'.repeat(201),
      error: null,
      digestEmailOptIn: false,
      digestOptInError: null,
    };
    expect(ideasPageReducer(state, { type: 'NICHE_SAVE_FAILED', error: 'boom' })).toEqual({
      status: 'needsNiche',
      niche: 'x'.repeat(201),
      error: 'boom',
      digestEmailOptIn: false,
      digestOptInError: null,
    });
  });

  it('returns from ideasReady to readyToGenerate on EDIT_NICHE', () => {
    const state: IdeasPageState = {
      status: 'ideasReady',
      niche: 'home baking',
      ideas: [IDEA],
      digestEmailOptIn: true,
      digestOptInError: null,
    };
    expect(ideasPageReducer(state, { type: 'EDIT_NICHE' })).toEqual({
      status: 'readyToGenerate',
      niche: 'home baking',
      digestEmailOptIn: true,
      digestOptInError: null,
    });
  });
});

describe('ideasPageReducer — generation', () => {
  const niche = 'home baking';

  it('moves readyToGenerate to generating on GENERATE', () => {
    const state: IdeasPageState = { status: 'readyToGenerate', niche, digestEmailOptIn: true, digestOptInError: null };
    expect(ideasPageReducer(state, { type: 'GENERATE' })).toEqual({
      status: 'generating',
      niche,
      stillWorking: false,
      digestEmailOptIn: true,
      digestOptInError: null,
    });
  });

  it('also allows GENERATE to retry from generationFailed', () => {
    const state: IdeasPageState = {
      status: 'generationFailed',
      niche,
      error: 'boom',
      digestEmailOptIn: false,
      digestOptInError: null,
    };
    expect(ideasPageReducer(state, { type: 'GENERATE' })).toEqual({
      status: 'generating',
      niche,
      stillWorking: false,
      digestEmailOptIn: false,
      digestOptInError: null,
    });
  });

  it('sets stillWorking on GENERATE_STILL_WORKING without changing status', () => {
    const state: IdeasPageState = {
      status: 'generating',
      niche,
      stillWorking: false,
      digestEmailOptIn: false,
      digestOptInError: null,
    };
    expect(ideasPageReducer(state, { type: 'GENERATE_STILL_WORKING' })).toEqual({ ...state, stillWorking: true });
  });

  it('moves to ideasReady on GENERATE_SUCCESS', () => {
    const state: IdeasPageState = {
      status: 'generating',
      niche,
      stillWorking: true,
      digestEmailOptIn: true,
      digestOptInError: null,
    };
    expect(ideasPageReducer(state, { type: 'GENERATE_SUCCESS', ideas: [IDEA] })).toEqual({
      status: 'ideasReady',
      niche,
      ideas: [IDEA],
      digestEmailOptIn: true,
      digestOptInError: null,
    });
  });

  it('moves to generationFailed preserving the niche on GENERATE_FAILED', () => {
    const state: IdeasPageState = {
      status: 'generating',
      niche,
      stillWorking: false,
      digestEmailOptIn: false,
      digestOptInError: null,
    };
    expect(ideasPageReducer(state, { type: 'GENERATE_FAILED', error: 'boom' })).toEqual({
      status: 'generationFailed',
      niche,
      error: 'boom',
      digestEmailOptIn: false,
      digestOptInError: null,
    });
  });

  it('ignores GENERATE from needsNiche (impossible-state guard)', () => {
    const state: IdeasPageState = { status: 'needsNiche', niche: '', error: null, digestEmailOptIn: false, digestOptInError: null };
    expect(ideasPageReducer(state, { type: 'GENERATE' })).toBe(state);
  });
});

describe('ideasPageReducer — digest email opt-in', () => {
  it('optimistically updates digestEmailOptIn and clears any prior error on DIGEST_OPT_IN_TOGGLED', () => {
    const state: IdeasPageState = {
      status: 'readyToGenerate',
      niche: 'home baking',
      digestEmailOptIn: false,
      digestOptInError: 'old error',
    };
    expect(ideasPageReducer(state, { type: 'DIGEST_OPT_IN_TOGGLED', optIn: true })).toEqual({
      status: 'readyToGenerate',
      niche: 'home baking',
      digestEmailOptIn: true,
      digestOptInError: null,
    });
  });

  it('reverts to the previous value and sets an error on DIGEST_OPT_IN_SAVE_FAILED', () => {
    const state: IdeasPageState = {
      status: 'ideasReady',
      niche: 'home baking',
      ideas: [IDEA],
      digestEmailOptIn: true,
      digestOptInError: null,
    };
    expect(ideasPageReducer(state, { type: 'DIGEST_OPT_IN_SAVE_FAILED', previousValue: false, error: 'boom' })).toEqual({
      status: 'ideasReady',
      niche: 'home baking',
      ideas: [IDEA],
      digestEmailOptIn: false,
      digestOptInError: 'boom',
    });
  });

  it('ignores DIGEST_OPT_IN_TOGGLED while loading (impossible-state guard)', () => {
    const state: IdeasPageState = { status: 'loading' };
    expect(ideasPageReducer(state, { type: 'DIGEST_OPT_IN_TOGGLED', optIn: true })).toBe(state);
  });
});

describe('ideasPageReducer — sign-in sub-flow', () => {
  it('updates the email field from needsSignIn', () => {
    const state: IdeasPageState = { status: 'needsSignIn', email: '', notice: null };
    expect(ideasPageReducer(state, { type: 'EMAIL_CHANGED', email: 'a@b.com' })).toEqual({
      status: 'needsSignIn',
      email: 'a@b.com',
      notice: null,
    });
  });

  it('moves to submittingMagicLink on SUBMIT_EMAIL with a valid email', () => {
    const state: IdeasPageState = { status: 'needsSignIn', email: 'a@b.com', notice: null };
    expect(ideasPageReducer(state, { type: 'SUBMIT_EMAIL' })).toEqual({ status: 'submittingMagicLink', email: 'a@b.com' });
  });

  it('ignores SUBMIT_EMAIL with an invalid email', () => {
    const state: IdeasPageState = { status: 'needsSignIn', email: 'not-an-email', notice: null };
    expect(ideasPageReducer(state, { type: 'SUBMIT_EMAIL' })).toBe(state);
  });

  it('moves to checkEmail on MAGIC_LINK_SENT', () => {
    const state: IdeasPageState = { status: 'submittingMagicLink', email: 'a@b.com' };
    expect(ideasPageReducer(state, { type: 'MAGIC_LINK_SENT' })).toEqual({ status: 'checkEmail', email: 'a@b.com' });
  });

  it('moves to magicLinkError on MAGIC_LINK_FAILED', () => {
    const state: IdeasPageState = { status: 'submittingMagicLink', email: 'a@b.com' };
    expect(ideasPageReducer(state, { type: 'MAGIC_LINK_FAILED', error: 'boom' })).toEqual({
      status: 'magicLinkError',
      email: 'a@b.com',
      error: 'boom',
    });
  });

  it('moves back to submittingMagicLink on RESEND_EMAIL', () => {
    const state: IdeasPageState = { status: 'checkEmail', email: 'a@b.com' };
    expect(ideasPageReducer(state, { type: 'RESEND_EMAIL' })).toEqual({ status: 'submittingMagicLink', email: 'a@b.com' });
  });

  it('moves back to needsSignIn on RETRY_EMAIL', () => {
    const state: IdeasPageState = { status: 'checkEmail', email: 'a@b.com' };
    expect(ideasPageReducer(state, { type: 'RETRY_EMAIL' })).toEqual({ status: 'needsSignIn', email: 'a@b.com', notice: null });
  });
});

describe('isNicheEditingState', () => {
  it('is true for needsNiche, readyToGenerate, and generationFailed', () => {
    expect(isNicheEditingState({ status: 'needsNiche', niche: '', error: null, digestEmailOptIn: false, digestOptInError: null })).toBe(
      true
    );
    expect(isNicheEditingState({ status: 'readyToGenerate', niche: 'x', digestEmailOptIn: false, digestOptInError: null })).toBe(true);
    expect(
      isNicheEditingState({ status: 'generationFailed', niche: 'x', error: 'e', digestEmailOptIn: false, digestOptInError: null })
    ).toBe(true);
  });

  it('is false for generating and ideasReady', () => {
    expect(
      isNicheEditingState({ status: 'generating', niche: 'x', stillWorking: false, digestEmailOptIn: false, digestOptInError: null })
    ).toBe(false);
    expect(
      isNicheEditingState({ status: 'ideasReady', niche: 'x', ideas: [], digestEmailOptIn: false, digestOptInError: null })
    ).toBe(false);
  });
});

describe('hasDigestOptInState', () => {
  it('is true for every niche-set or generation-related status', () => {
    expect(hasDigestOptInState({ status: 'needsNiche', niche: '', error: null, digestEmailOptIn: false, digestOptInError: null })).toBe(
      true
    );
    expect(hasDigestOptInState({ status: 'readyToGenerate', niche: 'x', digestEmailOptIn: false, digestOptInError: null })).toBe(true);
    expect(
      hasDigestOptInState({ status: 'generating', niche: 'x', stillWorking: false, digestEmailOptIn: false, digestOptInError: null })
    ).toBe(true);
    expect(hasDigestOptInState({ status: 'ideasReady', niche: 'x', ideas: [], digestEmailOptIn: false, digestOptInError: null })).toBe(
      true
    );
    expect(
      hasDigestOptInState({ status: 'generationFailed', niche: 'x', error: 'e', digestEmailOptIn: false, digestOptInError: null })
    ).toBe(true);
  });

  it('is false for loading and the sign-in sub-flow', () => {
    expect(hasDigestOptInState({ status: 'loading' })).toBe(false);
    expect(hasDigestOptInState({ status: 'needsSignIn', email: '', notice: null })).toBe(false);
  });
});
