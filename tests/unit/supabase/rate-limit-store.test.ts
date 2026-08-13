import { describe, it, expect } from 'vitest';
import { createSupabaseRateLimitStore } from '@/lib/supabase/rate-limit-store';
import { createFakeSupabaseClient } from '../../fakes/supabase-query-builder.fake';

describe('createSupabaseRateLimitStore', () => {
  it('counts zero events for a profile with no history', async () => {
    const client = createFakeSupabaseClient();
    const store = createSupabaseRateLimitStore(client as any);
    const count = await store.countEventsSince({
      profileId: 'profile-1',
      eventType: 'diagnostic_request',
      since: new Date('2026-01-01T00:00:00Z'),
    });
    expect(count).toBe(0);
  });

  it('records an event and then counts it', async () => {
    const client = createFakeSupabaseClient();
    const store = createSupabaseRateLimitStore(client as any);
    await store.recordEvent({
      profileId: 'profile-1',
      ipHash: 'ip-hash-1',
      eventType: 'diagnostic_request',
      createdAt: new Date('2026-08-12T00:00:00Z'),
    });
    const count = await store.countEventsSince({
      profileId: 'profile-1',
      eventType: 'diagnostic_request',
      since: new Date('2026-01-01T00:00:00Z'),
    });
    expect(count).toBe(1);
  });

  it('excludes events outside the requested window', async () => {
    const client = createFakeSupabaseClient();
    const store = createSupabaseRateLimitStore(client as any);
    await store.recordEvent({
      profileId: 'profile-1',
      ipHash: 'ip-hash-1',
      eventType: 'diagnostic_request',
      createdAt: new Date('2025-01-01T00:00:00Z'),
    });
    const count = await store.countEventsSince({
      profileId: 'profile-1',
      eventType: 'diagnostic_request',
      since: new Date('2026-01-01T00:00:00Z'),
    });
    expect(count).toBe(0);
  });

  describe('checkAndRecordAtomically', () => {
    it('sends the correct RPC params and maps an allowed response', async () => {
      let receivedParams: unknown;
      const client = createFakeSupabaseClient(
        {},
        {
          check_and_record_rate_limit: async (params) => {
            receivedParams = params;
            return { data: [{ allowed: true, reason: null, event_id: 'event-1' }], error: null };
          },
        }
      );
      const store = createSupabaseRateLimitStore(client as any);
      const result = await store.checkAndRecordAtomically({
        profileId: 'profile-1',
        ipHash: 'ip-hash-1',
        eventType: 'diagnostic_request',
        profileLimit: 1,
        ipLimit: 3,
        windowStart: new Date('2026-07-14T00:00:00Z'),
        now: new Date('2026-08-13T00:00:00Z'),
      });

      expect(receivedParams).toEqual({
        p_profile_id: 'profile-1',
        p_identity_hash: null,
        p_ip_hash: 'ip-hash-1',
        p_event_type: 'diagnostic_request',
        p_profile_limit: 1,
        p_ip_limit: 3,
        p_window_start: '2026-07-14T00:00:00.000Z',
        p_now: '2026-08-13T00:00:00.000Z',
      });
      expect(result).toEqual({ allowed: true, reason: undefined, eventId: 'event-1' });
    });

    it('sends p_profile_id as null and forwards identityHash when profileId is not provided', async () => {
      let receivedParams: unknown;
      const client = createFakeSupabaseClient(
        {},
        {
          check_and_record_rate_limit: async (params) => {
            receivedParams = params;
            return { data: [{ allowed: true, reason: null, event_id: 'event-2' }], error: null };
          },
        }
      );
      const store = createSupabaseRateLimitStore(client as any);
      await store.checkAndRecordAtomically({
        identityHash: 'email-hash-1',
        ipHash: 'ip-hash-1',
        eventType: 'magic_link_request',
        profileLimit: 3,
        ipLimit: 10,
        windowStart: new Date('2026-08-13T00:00:00Z'),
        now: new Date('2026-08-13T00:10:00Z'),
      });

      expect(receivedParams).toEqual({
        p_profile_id: null,
        p_identity_hash: 'email-hash-1',
        p_ip_hash: 'ip-hash-1',
        p_event_type: 'magic_link_request',
        p_profile_limit: 3,
        p_ip_limit: 10,
        p_window_start: '2026-08-13T00:00:00.000Z',
        p_now: '2026-08-13T00:10:00.000Z',
      });
    });

    it('maps a denied response with a reason', async () => {
      const client = createFakeSupabaseClient(
        {},
        {
          check_and_record_rate_limit: async () => ({
            data: [{ allowed: false, reason: 'profile_limit', event_id: null }],
            error: null,
          }),
        }
      );
      const store = createSupabaseRateLimitStore(client as any);
      const result = await store.checkAndRecordAtomically({
        profileId: 'profile-1',
        ipHash: 'ip-hash-1',
        eventType: 'diagnostic_request',
        profileLimit: 1,
        ipLimit: 3,
        windowStart: new Date('2026-07-14T00:00:00Z'),
        now: new Date('2026-08-13T00:00:00Z'),
      });
      expect(result).toEqual({ allowed: false, reason: 'profile_limit', eventId: undefined });
    });

    it('throws a descriptive error when the RPC call fails', async () => {
      const client = createFakeSupabaseClient(
        {},
        {
          check_and_record_rate_limit: async () => ({ data: null, error: { message: 'boom' } }),
        }
      );
      const store = createSupabaseRateLimitStore(client as any);
      await expect(
        store.checkAndRecordAtomically({
          profileId: 'profile-1',
          ipHash: 'ip-hash-1',
          eventType: 'diagnostic_request',
          profileLimit: 1,
          ipLimit: 3,
          windowStart: new Date('2026-07-14T00:00:00Z'),
          now: new Date('2026-08-13T00:00:00Z'),
        })
      ).rejects.toThrow('Failed to check and record rate limit: boom');
    });
  });

  describe('releaseEvent', () => {
    it('calls the release RPC with the event id', async () => {
      let receivedParams: unknown;
      const client = createFakeSupabaseClient(
        {},
        {
          release_rate_limit_event: async (params) => {
            receivedParams = params;
            return { data: null, error: null };
          },
        }
      );
      const store = createSupabaseRateLimitStore(client as any);
      await store.releaseEvent('event-1');
      expect(receivedParams).toEqual({ p_event_id: 'event-1' });
    });

    it('throws a descriptive error when the release RPC fails', async () => {
      const client = createFakeSupabaseClient(
        {},
        {
          release_rate_limit_event: async () => ({ data: null, error: { message: 'boom' } }),
        }
      );
      const store = createSupabaseRateLimitStore(client as any);
      await expect(store.releaseEvent('event-1')).rejects.toThrow('Failed to release rate limit event: boom');
    });
  });
});
