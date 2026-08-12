import { describe, it, expect } from 'vitest';
import { checkRateLimit, recordRateLimitEvent, hashIp } from '@/lib/rate-limit';
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

describe('hashIp', () => {
  it('produces a deterministic hash for the same IP and salt', () => {
    expect(hashIp('203.0.113.7', 'test-salt')).toBe(hashIp('203.0.113.7', 'test-salt'));
  });

  it('produces different hashes for different IPs', () => {
    expect(hashIp('203.0.113.7', 'test-salt')).not.toBe(hashIp('203.0.113.8', 'test-salt'));
  });
});
