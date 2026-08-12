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
});
