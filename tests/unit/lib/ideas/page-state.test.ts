import { describe, it, expect } from 'vitest';
import { ideasPageReducer, createInitialIdeasPageState, isNicheEditingState, type IdeasPageState } from '@/lib/ideas/page-state';
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
    const next = ideasPageReducer({ status: 'loading' }, { type: 'BOOTSTRAPPED', niche: '', ideas: null });
    expect(next).toEqual({ status: 'needsNiche', niche: '', error: null });
  });

  it('moves to readyToGenerate when a niche is already set and no digest exists yet', () => {
    const next = ideasPageReducer({ status: 'loading' }, { type: 'BOOTSTRAPPED', niche: 'home baking', ideas: null });
    expect(next).toEqual({ status: 'readyToGenerate', niche: 'home baking' });
  });

  it('moves straight to ideasReady when this week already has a digest', () => {
    const next = ideasPageReducer({ status: 'loading' }, { type: 'BOOTSTRAPPED', niche: 'home baking', ideas: [IDEA] });
    expect(next).toEqual({ status: 'ideasReady', niche: 'home baking', ideas: [IDEA] });
  });

  it('moves to needsNiche with an error on BOOTSTRAP_FAILED', () => {
    const next = ideasPageReducer({ status: 'loading' }, { type: 'BOOTSTRAP_FAILED' });
    expect(next).toEqual({
      status: 'needsNiche',
      niche: '',
      error: "We couldn't load your content ideas settings. Please refresh and try again.",
    });
  });

  it('moves to needsSignIn on BOOTSTRAP_UNAUTHORIZED', () => {
    const next = ideasPageReducer({ status: 'loading' }, { type: 'BOOTSTRAP_UNAUTHORIZED' });
    expect(next).toEqual({ status: 'needsSignIn', email: '', notice: null });
  });
});

describe('ideasPageReducer — niche editing', () => {
  it('updates the niche field from needsNiche', () => {
    const state: IdeasPageState = { status: 'needsNiche', niche: '', error: null };
    expect(ideasPageReducer(state, { type: 'NICHE_CHANGED', value: 'home baking' })).toEqual({
      status: 'needsNiche',
      niche: 'home baking',
      error: null,
    });
  });

  it('ignores NICHE_CHANGED while generating (impossible-state guard)', () => {
    const state: IdeasPageState = { status: 'generating', niche: 'home baking', stillWorking: false };
    expect(ideasPageReducer(state, { type: 'NICHE_CHANGED', value: 'x' })).toBe(state);
  });

  it('moves needsNiche to readyToGenerate on NICHE_SAVED', () => {
    const state: IdeasPageState = { status: 'needsNiche', niche: 'home baking', error: null };
    expect(ideasPageReducer(state, { type: 'NICHE_SAVED' })).toEqual({ status: 'readyToGenerate', niche: 'home baking' });
  });

  it('preserves the niche and sets an error on NICHE_SAVE_FAILED', () => {
    const state: IdeasPageState = { status: 'needsNiche', niche: 'x'.repeat(201), error: null };
    expect(ideasPageReducer(state, { type: 'NICHE_SAVE_FAILED', error: 'boom' })).toEqual({
      status: 'needsNiche',
      niche: 'x'.repeat(201),
      error: 'boom',
    });
  });

  it('returns from ideasReady to readyToGenerate on EDIT_NICHE', () => {
    const state: IdeasPageState = { status: 'ideasReady', niche: 'home baking', ideas: [IDEA] };
    expect(ideasPageReducer(state, { type: 'EDIT_NICHE' })).toEqual({ status: 'readyToGenerate', niche: 'home baking' });
  });
});

describe('ideasPageReducer — generation', () => {
  const niche = 'home baking';

  it('moves readyToGenerate to generating on GENERATE', () => {
    expect(ideasPageReducer({ status: 'readyToGenerate', niche }, { type: 'GENERATE' })).toEqual({
      status: 'generating',
      niche,
      stillWorking: false,
    });
  });

  it('also allows GENERATE to retry from generationFailed', () => {
    const state: IdeasPageState = { status: 'generationFailed', niche, error: 'boom' };
    expect(ideasPageReducer(state, { type: 'GENERATE' })).toEqual({ status: 'generating', niche, stillWorking: false });
  });

  it('sets stillWorking on GENERATE_STILL_WORKING without changing status', () => {
    const state: IdeasPageState = { status: 'generating', niche, stillWorking: false };
    expect(ideasPageReducer(state, { type: 'GENERATE_STILL_WORKING' })).toEqual({ status: 'generating', niche, stillWorking: true });
  });

  it('moves to ideasReady on GENERATE_SUCCESS', () => {
    const state: IdeasPageState = { status: 'generating', niche, stillWorking: true };
    expect(ideasPageReducer(state, { type: 'GENERATE_SUCCESS', ideas: [IDEA] })).toEqual({
      status: 'ideasReady',
      niche,
      ideas: [IDEA],
    });
  });

  it('carries the cached flag through to ideasReady on GENERATE_SUCCESS when cached: true', () => {
    const state: IdeasPageState = { status: 'generating', niche, stillWorking: false };
    expect(ideasPageReducer(state, { type: 'GENERATE_SUCCESS', ideas: [IDEA], cached: true })).toEqual({
      status: 'ideasReady',
      niche,
      ideas: [IDEA],
      cached: true,
    });
  });

  it('moves to generationFailed preserving the niche on GENERATE_FAILED', () => {
    const state: IdeasPageState = { status: 'generating', niche, stillWorking: false };
    expect(ideasPageReducer(state, { type: 'GENERATE_FAILED', error: 'boom' })).toEqual({
      status: 'generationFailed',
      niche,
      error: 'boom',
    });
  });

  it('ignores GENERATE from needsNiche (impossible-state guard)', () => {
    const state: IdeasPageState = { status: 'needsNiche', niche: '', error: null };
    expect(ideasPageReducer(state, { type: 'GENERATE' })).toBe(state);
  });
});

describe('ideasPageReducer — sign-in sub-flow', () => {
  it('collects the email from needsSignIn and submits it with a valid format', () => {
    const typed = ideasPageReducer(
      { status: 'needsSignIn', email: '', notice: null },
      { type: 'EMAIL_CHANGED', email: 'creator@example.com' }
    );
    expect(typed).toEqual({ status: 'needsSignIn', email: 'creator@example.com', notice: null });
    expect(ideasPageReducer(typed, { type: 'SUBMIT_EMAIL' })).toEqual({
      status: 'submittingMagicLink',
      email: 'creator@example.com',
    });
  });

  it('updates email from magicLinkError state', () => {
    const state: IdeasPageState = { status: 'magicLinkError', email: 'old@example.com', error: 'boom' };
    expect(ideasPageReducer(state, { type: 'EMAIL_CHANGED', email: 'new@example.com' })).toEqual({
      status: 'magicLinkError',
      email: 'new@example.com',
      error: 'boom',
    });
  });

  it('refuses to submit an email that is not a valid format', () => {
    const state: IdeasPageState = { status: 'needsSignIn', email: 'nope', notice: null };
    expect(ideasPageReducer(state, { type: 'SUBMIT_EMAIL' })).toBe(state);
  });

  it('ignores SUBMIT_EMAIL from a state where it does not apply (impossible-state guard)', () => {
    const state: IdeasPageState = { status: 'ideasReady', niche: 'home baking', ideas: [IDEA] };
    expect(ideasPageReducer(state, { type: 'SUBMIT_EMAIL' })).toBe(state);
  });

  it('moves to checkEmail on MAGIC_LINK_SENT and back to submitting on RESEND_EMAIL', () => {
    const sent = ideasPageReducer(
      { status: 'submittingMagicLink', email: 'creator@example.com' },
      { type: 'MAGIC_LINK_SENT' }
    );
    expect(sent).toEqual({ status: 'checkEmail', email: 'creator@example.com' });
    expect(ideasPageReducer(sent, { type: 'RESEND_EMAIL' })).toEqual({
      status: 'submittingMagicLink',
      email: 'creator@example.com',
    });
  });

  it('moves to needsSignIn on RETRY_EMAIL from checkEmail', () => {
    const state: IdeasPageState = { status: 'checkEmail', email: 'creator@example.com' };
    expect(ideasPageReducer(state, { type: 'RETRY_EMAIL' })).toEqual({
      status: 'needsSignIn',
      email: 'creator@example.com',
      notice: null,
    });
  });

  it('keeps the email on MAGIC_LINK_FAILED so it can be retried', () => {
    expect(
      ideasPageReducer({ status: 'submittingMagicLink', email: 'creator@example.com' }, { type: 'MAGIC_LINK_FAILED', error: 'boom' })
    ).toEqual({ status: 'magicLinkError', email: 'creator@example.com', error: 'boom' });
  });
});

describe('isNicheEditingState', () => {
  it('is true for needsNiche, readyToGenerate, and generationFailed', () => {
    expect(isNicheEditingState({ status: 'needsNiche', niche: '', error: null })).toBe(true);
    expect(isNicheEditingState({ status: 'readyToGenerate', niche: 'x' })).toBe(true);
    expect(isNicheEditingState({ status: 'generationFailed', niche: 'x', error: 'e' })).toBe(true);
  });

  it('is false for generating and ideasReady', () => {
    expect(isNicheEditingState({ status: 'generating', niche: 'x', stillWorking: false })).toBe(false);
    expect(isNicheEditingState({ status: 'ideasReady', niche: 'x', ideas: [] })).toBe(false);
  });
});
