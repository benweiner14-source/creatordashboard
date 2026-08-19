import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/types';

/**
 * 'past_due' still counts as entitled — Stripe is automatically retrying a
 * failed payment; access only turns off once retries are exhausted and the
 * subscription is genuinely canceled (the webhook then writes 'canceled').
 * See spec §6 / decision 5.
 */
export async function hasActiveSubscription(supabase: SupabaseClient<Database>, profileId: string): Promise<boolean> {
  const { data } = await supabase.from('subscriptions').select('status').eq('profile_id', profileId).maybeSingle();
  return data?.status === 'active' || data?.status === 'past_due';
}
