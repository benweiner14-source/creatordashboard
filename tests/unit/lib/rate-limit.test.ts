import { describe, it, expect } from 'vitest';
import {
  checkRateLimit,
  recordRateLimitEvent,
  checkAndRecordRateLimit,
  releaseRateLimitEvent,
  releaseRateLimitEventIfNeeded,
  hashIp,
  hashIdentity,
} from '@/lib/rate-limit';
import { createInMemoryRateLimitStore } from '../../fakes/rate-limit-store.fake';

describe('checkRateLimit', () => {
  it('allows the first diagnostic request for a fresh profile', async () => {
    const store = createInMemoryRateLimitStore();
    const result = await checkRateLimit({
      store,
      profileId: 'profile-1',
      ipHash: 'ip-hash-1',
      eventType: 'diagnostic_request',
    });
    expect(result.allowed).toBe(true);
  });

  it('blocks a second diagnostic request within the rolling window', async () => {
    const store = createInMemoryRateLimitStore();
    await recordRateLimitEvent({ store, profileId: 'profile-1', ipHash: 'ip-hash-1', eventType: 'diagnostic_request' });
    const result = await checkRateLimit({
      store,
      profileId: 'profile-1',
      ipHash: 'ip-hash-1',
      eventType: 'diagnostic_request',
      now: new Date('2026-08-12T12:00:00Z'),
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('profile_limit');
  });

  it('allows the same profile again after the window has passed', async () => {
    const store = createInMemoryRateLimitStore();
    await recordRateLimitEvent({
      store,
      profileId: 'profile-1',
      ipHash: 'ip-hash-1',
      eventType: 'diagnostic_request',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
    const result = await checkRateLimit({
      store,
      profileId: 'profile-1',
      ipHash: 'ip-hash-1',
      eventType: 'diagnostic_request',
      now: new Date('2026-08-12T12:00:00Z'),
    });
    expect(result.allowed).toBe(true);
  });

  it('blocks a fourth distinct profile from the same IP within the window', async () => {
    const store = createInMemoryRateLimitStore();
    await recordRateLimitEvent({ store, profileId: 'profile-1', ipHash: 'shared-ip', eventType: 'diagnostic_request' });
    await recordRateLimitEvent({ store, profileId: 'profile-2', ipHash: 'shared-ip', eventType: 'diagnostic_request' });
    await recordRateLimitEvent({ store, profileId: 'profile-3', ipHash: 'shared-ip', eventType: 'diagnostic_request' });
    const result = await checkRateLimit({
      store,
      profileId: 'profile-4',
      ipHash: 'shared-ip',
      eventType: 'diagnostic_request',
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('ip_limit');
  });
});

describe('checkAndRecordRateLimit', () => {
  it('allows and atomically records the first diagnostic request for a fresh profile', async () => {
    const store = createInMemoryRateLimitStore();
    const result = await checkAndRecordRateLimit({
      store,
      profileId: 'profile-1',
      ipHash: 'ip-hash-1',
      eventType: 'diagnostic_request',
    });
    expect(result.allowed).toBe(true);
    expect(result.eventId).toBeDefined();
  });

  it('denies a second request from the same profile within the window, without recording a new event', async () => {
    const store = createInMemoryRateLimitStore();
    const first = await checkAndRecordRateLimit({
      store,
      profileId: 'profile-1',
      ipHash: 'ip-hash-1',
      eventType: 'diagnostic_request',
      now: new Date('2026-08-12T12:00:00Z'),
    });
    const second = await checkAndRecordRateLimit({
      store,
      profileId: 'profile-1',
      ipHash: 'ip-hash-1',
      eventType: 'diagnostic_request',
      now: new Date('2026-08-12T12:05:00Z'),
    });
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(false);
    expect(second.reason).toBe('profile_limit');
    expect(second.retryAfter).toBeInstanceOf(Date);
    expect(second.eventId).toBeUndefined();
  });

  it('allows the same profile again after the window has passed', async () => {
    const store = createInMemoryRateLimitStore();
    await checkAndRecordRateLimit({
      store,
      profileId: 'profile-1',
      ipHash: 'ip-hash-1',
      eventType: 'diagnostic_request',
      now: new Date('2026-01-01T00:00:00Z'),
    });
    const result = await checkAndRecordRateLimit({
      store,
      profileId: 'profile-1',
      ipHash: 'ip-hash-1',
      eventType: 'diagnostic_request',
      now: new Date('2026-08-12T12:00:00Z'),
    });
    expect(result.allowed).toBe(true);
  });

  it('denies a fourth distinct profile from the same IP within the window', async () => {
    const store = createInMemoryRateLimitStore();
    await checkAndRecordRateLimit({ store, profileId: 'profile-1', ipHash: 'shared-ip', eventType: 'diagnostic_request' });
    await checkAndRecordRateLimit({ store, profileId: 'profile-2', ipHash: 'shared-ip', eventType: 'diagnostic_request' });
    await checkAndRecordRateLimit({ store, profileId: 'profile-3', ipHash: 'shared-ip', eventType: 'diagnostic_request' });
    const result = await checkAndRecordRateLimit({ store, profileId: 'profile-4', ipHash: 'shared-ip', eventType: 'diagnostic_request' });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('ip_limit');
  });

  it('accepts a custom policy so callers other than the diagnostic flow can reuse it', async () => {
    const store = createInMemoryRateLimitStore();
    const result = await checkAndRecordRateLimit({
      store,
      profileId: 'profile-1',
      ipHash: 'ip-hash-1',
      eventType: 'magic_link_request',
      profileLimit: 5,
      ipLimit: 20,
      windowDays: 1,
    });
    expect(result.allowed).toBe(true);
  });

  it('does not allow two concurrent calls for the same profile to both succeed when the limit is 1', async () => {
    const store = createInMemoryRateLimitStore();
    const now = new Date('2026-08-13T12:00:00Z');
    const call = () =>
      checkAndRecordRateLimit({ store, profileId: 'profile-1', ipHash: 'ip-1', eventType: 'diagnostic_request', now });
    const [first, second] = await Promise.all([call(), call()]);
    const allowedCount = [first, second].filter((r) => r.allowed).length;
    expect(allowedCount).toBe(1);
  });
});

describe('releaseRateLimitEvent', () => {
  it('removes a previously-recorded event so it no longer counts toward the limit', async () => {
    const store = createInMemoryRateLimitStore();
    const recorded = await checkAndRecordRateLimit({
      store,
      profileId: 'profile-1',
      ipHash: 'ip-hash-1',
      eventType: 'diagnostic_request',
      now: new Date('2026-08-12T12:00:00Z'),
    });
    await releaseRateLimitEvent({ store, eventId: recorded.eventId! });
    const second = await checkAndRecordRateLimit({
      store,
      profileId: 'profile-1',
      ipHash: 'ip-hash-1',
      eventType: 'diagnostic_request',
      now: new Date('2026-08-12T12:05:00Z'),
    });
    expect(second.allowed).toBe(true);
  });
});

describe('releaseRateLimitEventIfNeeded', () => {
  it('releases the event when an eventId is provided', async () => {
    const store = createInMemoryRateLimitStore();
    const recorded = await checkAndRecordRateLimit({
      store,
      profileId: 'profile-1',
      ipHash: 'ip-hash-1',
      eventType: 'diagnostic_request',
      now: new Date('2026-08-12T12:00:00Z'),
    });
    await releaseRateLimitEventIfNeeded({ store, eventId: recorded.eventId });
    const second = await checkAndRecordRateLimit({
      store,
      profileId: 'profile-1',
      ipHash: 'ip-hash-1',
      eventType: 'diagnostic_request',
      now: new Date('2026-08-12T12:05:00Z'),
    });
    expect(second.allowed).toBe(true);
  });

  it('is a no-op when eventId is undefined', async () => {
    const store = createInMemoryRateLimitStore();
    await expect(releaseRateLimitEventIfNeeded({ store, eventId: undefined })).resolves.toBeUndefined();
  });

  it('swallows a release failure instead of throwing, so it never masks the original error', async () => {
    const store = createInMemoryRateLimitStore();
    store.releaseEvent = async () => {
      throw new Error('boom');
    };
    await expect(releaseRateLimitEventIfNeeded({ store, eventId: 'event-1' })).resolves.toBeUndefined();
  });
});

describe('checkAndRecordRateLimit — identityHash (non-profile identity)', () => {
  it('allows and atomically records the first request for a fresh identity', async () => {
    const store = createInMemoryRateLimitStore();
    const result = await checkAndRecordRateLimit({
      store,
      identityHash: 'email-hash-1',
      ipHash: 'ip-hash-1',
      eventType: 'magic_link_request',
    });
    expect(result.allowed).toBe(true);
    expect(result.eventId).toBeDefined();
  });

  it('denies a second request from the same identity within the window', async () => {
    const store = createInMemoryRateLimitStore();
    await checkAndRecordRateLimit({
      store,
      identityHash: 'email-hash-1',
      ipHash: 'ip-hash-1',
      eventType: 'magic_link_request',
      profileLimit: 1,
      now: new Date('2026-08-12T12:00:00Z'),
    });
    const second = await checkAndRecordRateLimit({
      store,
      identityHash: 'email-hash-1',
      ipHash: 'ip-hash-1',
      eventType: 'magic_link_request',
      profileLimit: 1,
      now: new Date('2026-08-12T12:05:00Z'),
    });
    expect(second.allowed).toBe(false);
    expect(second.reason).toBe('profile_limit');
  });

  it('keeps identityHash and profileId counts independent even with the same event type', async () => {
    const store = createInMemoryRateLimitStore();
    await checkAndRecordRateLimit({
      store,
      profileId: 'shared-value',
      ipHash: 'ip-hash-1',
      eventType: 'shared_event_type',
      profileLimit: 1,
    });
    const result = await checkAndRecordRateLimit({
      store,
      identityHash: 'shared-value',
      ipHash: 'ip-hash-2',
      eventType: 'shared_event_type',
      profileLimit: 1,
    });
    expect(result.allowed).toBe(true);
  });

  it('throws when neither profileId nor identityHash is provided', async () => {
    const store = createInMemoryRateLimitStore();
    await expect(
      checkAndRecordRateLimit({ store, ipHash: 'ip-hash-1', eventType: 'magic_link_request' })
    ).rejects.toThrow('checkAndRecordRateLimit requires either profileId or identityHash');
  });

  it('throws when both profileId and identityHash are provided', async () => {
    const store = createInMemoryRateLimitStore();
    await expect(
      checkAndRecordRateLimit({
        store,
        profileId: 'profile-1',
        identityHash: 'email-hash-1',
        ipHash: 'ip-hash-1',
        eventType: 'magic_link_request',
      })
    ).rejects.toThrow('checkAndRecordRateLimit accepts only one of profileId or identityHash');
  });
});

describe('hashIp', () => {
  it('produces a deterministic hash for the same IP and salt', () => {
    expect(hashIp('203.0.113.7', 'test-salt')).toBe(hashIp('203.0.113.7', 'test-salt'));
  });

  it('produces different hashes for different IPs', () => {
    expect(hashIp('203.0.113.7', 'test-salt')).not.toBe(hashIp('203.0.113.8', 'test-salt'));
  });
});

describe('hashIdentity', () => {
  it('produces a deterministic hash for the same value and salt', () => {
    expect(hashIdentity('creator@example.com', 'test-salt')).toBe(hashIdentity('creator@example.com', 'test-salt'));
  });

  it('produces different hashes for different values', () => {
    expect(hashIdentity('a@example.com', 'test-salt')).not.toBe(hashIdentity('b@example.com', 'test-salt'));
  });

  it('is what hashIp delegates to', () => {
    expect(hashIp('203.0.113.7', 'test-salt')).toBe(hashIdentity('203.0.113.7', 'test-salt'));
  });
});
