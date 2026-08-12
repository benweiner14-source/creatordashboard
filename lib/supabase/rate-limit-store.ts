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
  };
}
