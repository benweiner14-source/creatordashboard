import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { createSupabaseRateLimitStore } from '@/lib/supabase/rate-limit-store';
import { createStripeClient } from '@/lib/integrations/stripe';
import { handleDeleteAccountRequest } from '@/lib/settings/delete-account-handler';

export async function POST() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const serviceClient = createSupabaseServiceRoleClient();
  const stripeClient = createStripeClient(process.env.STRIPE_SECRET_KEY ?? '');

  const result = await handleDeleteAccountRequest(
    {
      rateLimitStore: createSupabaseRateLimitStore(serviceClient),
      getActiveStripeSubscriptionId: async (profileId) => {
        const { data } = await serviceClient
          .from('subscriptions')
          .select('stripe_subscription_id, status')
          .eq('profile_id', profileId)
          .maybeSingle();
        if (!data || !data.stripe_subscription_id) return null;
        return data.status === 'active' || data.status === 'past_due' ? data.stripe_subscription_id : null;
      },
      cancelStripeSubscription: (subscriptionId) => stripeClient.cancelSubscription(subscriptionId),
      scheduleDeletion: async (profileId, deletionAt) => {
        const { error } = await serviceClient
          .from('profiles')
          .update({ scheduled_deletion_at: deletionAt.toISOString() })
          .eq('id', profileId);
        if (error) {
          throw new Error(`Failed to schedule deletion: ${error.message}`);
        }
      },
      signOut: async () => {
        const { error } = await supabase.auth.signOut();
        if (error) {
          // The subscription cancellation and scheduled_deletion_at write above have
          // already succeeded, so a signOut failure here must not fail the request —
          // that would look like the whole deletion request failed and could prompt a
          // retry, when the account is already correctly scheduled for deletion. Log
          // it so a lingering session is visible rather than silently discarded.
          console.error('Sign-out failed after scheduling account deletion:', error);
        }
      },
    },
    { profileId: user?.id ?? null }
  );

  return NextResponse.json(result.body, { status: result.status });
}
