import { describe, it, expect } from 'vitest';
import { checkRateLimit, recordRateLimitEvent, checkAndRecordRateLimit, releaseRateLimitEvent, hashIp } from '@/lib/rate-limit';
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

describe('hashIp', () => {
  it('produces a deterministic hash for the same IP and salt', () => {
    expect(hashIp('203.0.113.7', 'test-salt')).toBe(hashIp('203.0.113.7', 'test-salt'));
  });

  it('produces different hashes for different IPs', () => {
    expect(hashIp('203.0.113.7', 'test-salt')).not.toBe(hashIp('203.0.113.8', 'test-salt'));
  });
});
