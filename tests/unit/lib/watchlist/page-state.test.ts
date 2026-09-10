// tests/unit/lib/watchlist/page-state.test.ts
import { describe, it, expect } from 'vitest';
import { watchlistPageReducer, createInitialWatchlistPageState } from '@/lib/watchlist/page-state';
import type { WatchlistEntryView } from '@/lib/watchlist/types';

function makeEntry(overrides: Partial<WatchlistEntryView> = {}): WatchlistEntryView {
  return {
    id: 'entry-1',
    platform: 'youtube',
    handle: 'creator',
    url: 'https://www.youtube.com/@creator',
    label: null,
    lastError: null,
    hasSnapshot: true,
    subscriberCount: 1000,
    totalViewCount: 50000,
    videoCount: 20,
    topPosts: [],
    sevenDayDelta: null,
    thirtyDayDelta: null,
    ...overrides,
  };
}

describe('watchlistPageReducer', () => {
  it('starts in the loading state', () => {
    expect(createInitialWatchlistPageState()).toEqual({ status: 'loading' });
  });

  it('moves to loaded on BOOTSTRAPPED', () => {
    const state = watchlistPageReducer(createInitialWatchlistPageState(), {
      type: 'BOOTSTRAPPED',
      entries: [makeEntry()],
      subscriptionRequired: false,
    });
    expect(state).toEqual({
      status: 'loaded',
      entries: [makeEntry()],
      subscriptionRequired: false,
      addUrl: '',
      addLabel: '',
      adding: false,
      addStillWorking: false,
      addError: null,
      removingEntryId: null,
      removeError: null,
    });
  });

  it('moves to needsSignIn on BOOTSTRAP_UNAUTHORIZED', () => {
    const state = watchlistPageReducer(createInitialWatchlistPageState(), { type: 'BOOTSTRAP_UNAUTHORIZED' });
    expect(state).toEqual({ status: 'needsSignIn', email: '', notice: null });
  });

  it('degrades to an empty loaded state on BOOTSTRAP_FAILED', () => {
    const state = watchlistPageReducer(createInitialWatchlistPageState(), { type: 'BOOTSTRAP_FAILED' });
    expect(state.status).toBe('loaded');
    expect((state as any).entries).toEqual([]);
  });

  describe('from a loaded state', () => {
    const loaded = watchlistPageReducer(createInitialWatchlistPageState(), {
      type: 'BOOTSTRAPPED',
      entries: [],
      subscriptionRequired: false,
    });

    it('updates addUrl on ADD_URL_CHANGED', () => {
      const next = watchlistPageReducer(loaded, { type: 'ADD_URL_CHANGED', value: 'https://tiktok.com/@x' });
      expect((next as any).addUrl).toBe('https://tiktok.com/@x');
    });

    it('ignores ADD_URL_CHANGED while adding is in flight', () => {
      const adding = watchlistPageReducer(loaded, { type: 'ADD_SUBMIT' });
      const next = watchlistPageReducer(adding, { type: 'ADD_URL_CHANGED', value: 'https://tiktok.com/@x' });
      expect((next as any).addUrl).toBe('');
    });

    it('sets adding true on ADD_SUBMIT', () => {
      const next = watchlistPageReducer(loaded, { type: 'ADD_SUBMIT' });
      expect((next as any).adding).toBe(true);
    });

    it('resets add fields and updates entries on ADD_SUCCESS', () => {
      const adding = watchlistPageReducer(loaded, { type: 'ADD_SUBMIT' });
      const next = watchlistPageReducer(adding, { type: 'ADD_SUCCESS', entries: [makeEntry()], subscriptionRequired: true });
      expect((next as any).adding).toBe(false);
      expect((next as any).entries).toEqual([makeEntry()]);
      expect((next as any).subscriptionRequired).toBe(true);
      expect((next as any).addUrl).toBe('');
    });

    it('sets addError and clears adding on ADD_FAILED', () => {
      const adding = watchlistPageReducer(loaded, { type: 'ADD_SUBMIT' });
      const next = watchlistPageReducer(adding, { type: 'ADD_FAILED', error: 'Nope' });
      expect((next as any).adding).toBe(false);
      expect((next as any).addError).toBe('Nope');
    });

    it('sets removingEntryId on REMOVE_REQUESTED and clears it on REMOVE_SUCCESS, filtering the entry out', () => {
      const withEntry = watchlistPageReducer(createInitialWatchlistPageState(), {
        type: 'BOOTSTRAPPED',
        entries: [makeEntry({ id: 'entry-1' }), makeEntry({ id: 'entry-2' })],
        subscriptionRequired: false,
      });
      const removing = watchlistPageReducer(withEntry, { type: 'REMOVE_REQUESTED', entryId: 'entry-1' });
      expect((removing as any).removingEntryId).toBe('entry-1');
      const removed = watchlistPageReducer(removing, { type: 'REMOVE_SUCCESS', entryId: 'entry-1' });
      expect((removed as any).removingEntryId).toBeNull();
      expect((removed as any).entries.map((e: WatchlistEntryView) => e.id)).toEqual(['entry-2']);
    });

    it('sets removeError and clears removingEntryId on REMOVE_FAILED', () => {
      const removing = watchlistPageReducer(loaded, { type: 'REMOVE_REQUESTED', entryId: 'entry-1' });
      const failed = watchlistPageReducer(removing, { type: 'REMOVE_FAILED', error: 'Could not remove' });
      expect((failed as any).removingEntryId).toBeNull();
      expect((failed as any).removeError).toBe('Could not remove');
    });
  });

  describe('sign-in sub-flow', () => {
    it('moves through email change, submit, and magic link sent', () => {
      const needsSignIn = watchlistPageReducer(createInitialWatchlistPageState(), { type: 'BOOTSTRAP_UNAUTHORIZED' });
      const emailEntered = watchlistPageReducer(needsSignIn, { type: 'EMAIL_CHANGED', email: 'jordan@example.com' });
      const submitting = watchlistPageReducer(emailEntered, { type: 'SUBMIT_EMAIL' });
      expect(submitting).toEqual({ status: 'submittingMagicLink', email: 'jordan@example.com' });
      const sent = watchlistPageReducer(submitting, { type: 'MAGIC_LINK_SENT' });
      expect(sent).toEqual({ status: 'checkEmail', email: 'jordan@example.com' });
    });

    it('ignores SUBMIT_EMAIL for an invalid email format', () => {
      const needsSignIn = watchlistPageReducer(createInitialWatchlistPageState(), { type: 'BOOTSTRAP_UNAUTHORIZED' });
      const emailEntered = watchlistPageReducer(needsSignIn, { type: 'EMAIL_CHANGED', email: 'not-an-email' });
      const result = watchlistPageReducer(emailEntered, { type: 'SUBMIT_EMAIL' });
      expect(result.status).toBe('needsSignIn');
    });
  });
});
