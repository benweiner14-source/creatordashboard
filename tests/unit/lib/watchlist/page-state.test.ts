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
    isStale: false,
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
      bootstrapError: null,
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

  it('attaches an explicit error on BOOTSTRAP_FAILED so it is not mistaken for an empty watchlist', () => {
    const state = watchlistPageReducer(createInitialWatchlistPageState(), { type: 'BOOTSTRAP_FAILED' });
    expect(state.status).toBe('loaded');
    expect((state as any).entries).toEqual([]);
    expect((state as any).bootstrapError).toMatch(/couldn't load your watchlist/i);
  });

  it('clears the bootstrap error once a later ADD_SUCCESS re-fetches the list', () => {
    const failed = watchlistPageReducer(createInitialWatchlistPageState(), { type: 'BOOTSTRAP_FAILED' });
    const adding = watchlistPageReducer(failed, { type: 'ADD_SUBMIT' });
    const next = watchlistPageReducer(adding, { type: 'ADD_SUCCESS', entries: [makeEntry()], subscriptionRequired: false });
    expect((next as any).bootstrapError).toBeNull();
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

    it('merges one refreshed entry into the list by id on REFRESH_ENTRY_SUCCESS, leaving the others alone', () => {
      const withEntries = watchlistPageReducer(createInitialWatchlistPageState(), {
        type: 'BOOTSTRAPPED',
        entries: [
          makeEntry({ id: 'entry-1', isStale: true, hasSnapshot: false, subscriberCount: null }),
          makeEntry({ id: 'entry-2', isStale: true, hasSnapshot: false, subscriberCount: null }),
        ],
        subscriptionRequired: false,
      });

      const refreshed = watchlistPageReducer(withEntries, {
        type: 'REFRESH_ENTRY_SUCCESS',
        entry: makeEntry({ id: 'entry-2', isStale: false, hasSnapshot: true, subscriberCount: 8800 }),
      });

      const entries = (refreshed as any).entries as WatchlistEntryView[];
      expect(entries.map((e) => e.id)).toEqual(['entry-1', 'entry-2']);
      expect(entries[0].subscriberCount).toBeNull();
      expect(entries[1].subscriberCount).toBe(8800);
      expect(entries[1].isStale).toBe(false);
    });

    it('ignores REFRESH_ENTRY_SUCCESS for an entry that is no longer in the list', () => {
      const withEntry = watchlistPageReducer(createInitialWatchlistPageState(), {
        type: 'BOOTSTRAPPED',
        entries: [makeEntry({ id: 'entry-1' })],
        subscriptionRequired: false,
      });
      const removed = watchlistPageReducer(withEntry, { type: 'REMOVE_SUCCESS', entryId: 'entry-1' });

      const next = watchlistPageReducer(removed, { type: 'REFRESH_ENTRY_SUCCESS', entry: makeEntry({ id: 'entry-1' }) });

      expect((next as any).entries).toEqual([]);
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

    it('ignores a second REMOVE_REQUESTED while a removal is already in flight', () => {
      const withEntries = watchlistPageReducer(createInitialWatchlistPageState(), {
        type: 'BOOTSTRAPPED',
        entries: [makeEntry({ id: 'entry-1' }), makeEntry({ id: 'entry-2' })],
        subscriptionRequired: false,
      });
      const removingFirst = watchlistPageReducer(withEntries, { type: 'REMOVE_REQUESTED', entryId: 'entry-1' });
      expect((removingFirst as any).removingEntryId).toBe('entry-1');

      const afterSecondRequest = watchlistPageReducer(removingFirst, { type: 'REMOVE_REQUESTED', entryId: 'entry-2' });
      expect((afterSecondRequest as any).removingEntryId).toBe('entry-1');
      expect(afterSecondRequest).toBe(removingFirst);
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
