import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';
import type { RateLimitStore } from '@/lib/rate-limit';

export function createSupabaseRateLimitStore(supabase: SupabaseClient<Database>): RateLimitStore {
  return {
    async countEventsSince({ profileId, ipHash, eventType, since }) {
      let query = supabase
        .from('rate_limit_events')
        .select('id', { count: 'exact', head: true })
        .eq('event_type', eventType)
        .gte('created_at', since.toISOString());

      if (profileId !== undefined) {
        query = query.eq('profile_id', profileId);
      }
      if (ipHash !== undefined) {
        query = query.eq('ip_hash', ipHash);
      }

      const { count, error } = await query;
      if (error) {
        throw new Error(`Failed to count rate limit events: ${error.message}`);
      }
      return count ?? 0;
    },
    async recordEvent({ profileId, ipHash, eventType, createdAt }) {
      const { error } = await supabase.from('rate_limit_events').insert({
        profile_id: profileId,
        ip_hash: ipHash,
        event_type: eventType,
        created_at: (createdAt ?? new Date()).toISOString(),
      });
      if (error) {
        throw new Error(`Failed to record rate limit event: ${error.message}`);
      }
    },
    async checkAndRecordAtomically({ profileId, ipHash, eventType, profileLimit, ipLimit, windowStart, now }) {
      const { data, error } = await supabase.rpc('check_and_record_rate_limit', {
        p_profile_id: profileId,
        p_ip_hash: ipHash,
        p_event_type: eventType,
        p_profile_limit: profileLimit,
        p_ip_limit: ipLimit,
        p_window_start: windowStart.toISOString(),
        p_now: now.toISOString(),
      });
      if (error) {
        throw new Error(`Failed to check and record rate limit: ${error.message}`);
      }
      const row = (Array.isArray(data) ? data[0] : data) as { allowed: boolean; reason: string | null; event_id: string | null };
      return {
        allowed: row.allowed,
        reason: (row.reason ?? undefined) as 'profile_limit' | 'ip_limit' | undefined,
        eventId: row.event_id ?? undefined,
      };
    },
    async releaseEvent(eventId) {
      const { error } = await supabase.rpc('release_rate_limit_event', { p_event_id: eventId });
      if (error) {
        throw new Error(`Failed to release rate limit event: ${error.message}`);
      }
    },
  };
}
