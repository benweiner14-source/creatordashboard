import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { createSupabaseRateLimitStore } from '@/lib/supabase/rate-limit-store';
import { createLinkedInIdeasClient } from '@/lib/integrations/claude-linkedin-ideas';
import { deriveClientIp } from '@/lib/ip';
import { handleLinkedInIdeasRequest } from '@/lib/linkedin/ideas-handler';
import { weekStartKey } from '@/lib/ideas/handler';
import { hasActiveSubscription } from '@/lib/billing/entitlements';
import type { LinkedInIdeasRow } from '@/lib/linkedin/ideas-handler';
import type { LinkedInPostIdea } from '@/lib/integrations/claude-linkedin-ideas';

// Postgres unique-violation. The `linkedin_post_ideas` table has a
// `unique (profile_id, week_start)` constraint, so two concurrent POSTs that
// both miss the cached-row check will race to insert and one of them will hit
// this — a success for the creator, not a failure worth a 500.
const UNIQUE_VIOLATION = '23505';

function mapIdeasRow(row: { id: string; strategy_id: string; week_start: string; post_ideas: unknown }): LinkedInIdeasRow {
  return {
    id: row.id,
    strategyId: row.strategy_id,
    weekStart: row.week_start,
    postIdeas: row.post_ideas as LinkedInPostIdea[],
  };
}

/**
 * Read-only: returns this week's already-generated ideas, or null. Generating
 * costs money and consumes a rate-limit slot, so it lives on POST below —
 * matching `app/api/ideas/route.ts`, and keeping a cross-site navigation or a
 * link prefetch from spending a signed-in creator's weekly generation.
 */
export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'You must be signed in to view your LinkedIn post ideas.' }, { status: 401 });
  }

  const serviceClient = createSupabaseServiceRoleClient();
  if (!(await hasActiveSubscription(serviceClient, user.id))) {
    return NextResponse.json(
      { error: 'LinkedIn Content Strategy requires an active subscription.', upgradeUrl: '/billing' },
      { status: 402 }
    );
  }

  const { data: existing } = await serviceClient
    .from('linkedin_post_ideas')
    .select('*')
    .eq('profile_id', user.id)
    .eq('week_start', weekStartKey(new Date()))
    .maybeSingle();

  return NextResponse.json({ ideas: existing ? mapIdeasRow(existing) : null });
}

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const serviceClient = createSupabaseServiceRoleClient();
    const ip = deriveClientIp({
      headers: request.headers,
      isTrustedPlatform: process.env.VERCEL === '1',
      trustedProxyHops: process.env.TRUSTED_PROXY_HOPS ? Number(process.env.TRUSTED_PROXY_HOPS) : undefined,
    });

    const result = await handleLinkedInIdeasRequest(
      {
        rateLimitStore: createSupabaseRateLimitStore(serviceClient),
        linkedInIdeasClient: createLinkedInIdeasClient(process.env.ANTHROPIC_API_KEY ?? ''),
        ipSalt: process.env.RATE_LIMIT_IP_SALT ?? 'dev-salt',
        hasActiveSubscription: (profileId) => hasActiveSubscription(serviceClient, profileId),
        getLatestStrategy: async (profileId) => {
          const { data } = await serviceClient
            .from('linkedin_strategies')
            .select('id, niche, target_goal')
            .eq('profile_id', profileId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          return data ? { id: data.id, niche: data.niche, targetGoal: data.target_goal } : null;
        },
        getExistingIdeas: async (profileId, weekStart) => {
          const { data } = await serviceClient
            .from('linkedin_post_ideas')
            .select('*')
            .eq('profile_id', profileId)
            .eq('week_start', weekStart)
            .maybeSingle();
          return data ? mapIdeasRow(data) : null;
        },
        saveIdeas: async ({ profileId, strategyId, weekStart, postIdeas }) => {
          const { data, error } = await serviceClient
            .from('linkedin_post_ideas')
            .insert({ profile_id: profileId, strategy_id: strategyId, week_start: weekStart, post_ideas: postIdeas })
            .select('*')
            .single();

          if (error?.code === UNIQUE_VIOLATION) {
            // A concurrent request already saved this week's ideas. Theirs are
            // just as valid as ours, so hand those back rather than throwing —
            // throwing would release our rate-limit slot and show a 500 for
            // work that in fact succeeded.
            const { data: raced } = await serviceClient
              .from('linkedin_post_ideas')
              .select('*')
              .eq('profile_id', profileId)
              .eq('week_start', weekStart)
              .maybeSingle();
            if (raced) return mapIdeasRow(raced);
          }

          if (error || !data) {
            throw new Error(`Failed to save LinkedIn post ideas: ${error?.message}`);
          }
          return mapIdeasRow(data);
        },
      },
      { profileId: user?.id ?? null, ip, now: new Date() }
    );

    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    console.error('LinkedIn post ideas generation failed:', err);
    return NextResponse.json({ error: 'Something went wrong generating your post ideas. Please try again.' }, { status: 500 });
  }
}
