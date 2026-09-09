import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { createSupabaseRateLimitStore } from '@/lib/supabase/rate-limit-store';
import { createLinkedInIdeasClient } from '@/lib/integrations/claude-linkedin-ideas';
import { deriveClientIp } from '@/lib/ip';
import { handleLinkedInIdeasRequest } from '@/lib/linkedin/ideas-handler';
import { hasActiveSubscription } from '@/lib/billing/entitlements';
import type { LinkedInIdeasRow } from '@/lib/linkedin/ideas-handler';
import type { LinkedInPostIdea } from '@/lib/integrations/claude-linkedin-ideas';

function mapIdeasRow(row: { id: string; strategy_id: string; week_start: string; post_ideas: unknown }): LinkedInIdeasRow {
  return {
    id: row.id,
    strategyId: row.strategy_id,
    weekStart: row.week_start,
    postIdeas: row.post_ideas as LinkedInPostIdea[],
  };
}

export async function GET(request: Request) {
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
