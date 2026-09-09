import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { createSupabaseRateLimitStore } from '@/lib/supabase/rate-limit-store';
import { createLinkedInStrategyClient } from '@/lib/integrations/claude-linkedin-strategy';
import { deriveClientIp } from '@/lib/ip';
import { handleLinkedInStrategyRequest } from '@/lib/linkedin/strategy-handler';
import { hasActiveSubscription } from '@/lib/billing/entitlements';
import type { SavedLinkedInStrategy } from '@/lib/linkedin/strategy-handler';

interface StrategyRow {
  id: string;
  niche: string;
  target_goal: string;
  content_pillars: unknown;
  posting_cadence_recommendation: string;
  positioning_notes: string;
  headline: string;
  created_at: string;
}

function mapStrategyRow(row: StrategyRow): SavedLinkedInStrategy {
  return {
    id: row.id,
    niche: row.niche,
    targetGoal: row.target_goal,
    contentPillars: row.content_pillars as string[],
    postingCadenceRecommendation: row.posting_cadence_recommendation,
    positioningNotes: row.positioning_notes,
    headline: row.headline,
    createdAt: row.created_at,
  };
}

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 });
  }

  const serviceClient = createSupabaseServiceRoleClient();
  if (!(await hasActiveSubscription(serviceClient, user.id))) {
    return NextResponse.json(
      { error: 'LinkedIn Content Strategy requires an active subscription.', upgradeUrl: '/billing' },
      { status: 402 }
    );
  }

  const { data: rows } = await serviceClient
    .from('linkedin_strategies')
    .select('id, niche, target_goal, content_pillars, posting_cadence_recommendation, positioning_notes, headline, created_at')
    .eq('profile_id', user.id)
    .order('created_at', { ascending: false })
    .limit(10);

  const history = (rows ?? []).map((row) => ({
    id: row.id,
    niche: row.niche,
    targetGoal: row.target_goal,
    headline: row.headline,
    createdAt: row.created_at,
  }));

  const latest = rows && rows.length > 0 ? mapStrategyRow(rows[0] as StrategyRow) : null;

  return NextResponse.json({ ok: true, latest, history });
}

export async function POST(request: Request) {
  try {
    let body: { niche?: string; targetGoal?: string };
    try {
      body = (await request.json()) as { niche?: string; targetGoal?: string };
    } catch {
      // A body that isn't valid JSON is the caller's mistake — a 400, not the
      // catch-all 500 below that reads as "something broke on our end".
      return NextResponse.json({ error: "We couldn't read that request. A niche and a goal are required." }, { status: 400 });
    }

    const { niche, targetGoal } = body;
    if (!niche || !targetGoal) {
      return NextResponse.json({ error: 'A niche and a goal are required.' }, { status: 400 });
    }

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

    const result = await handleLinkedInStrategyRequest(
      {
        rateLimitStore: createSupabaseRateLimitStore(serviceClient),
        linkedInStrategyClient: createLinkedInStrategyClient(process.env.ANTHROPIC_API_KEY ?? ''),
        ipSalt: process.env.RATE_LIMIT_IP_SALT ?? 'dev-salt',
        hasActiveSubscription: (profileId) => hasActiveSubscription(serviceClient, profileId),
        saveStrategy: async ({ profileId, niche, targetGoal, strategy }) => {
          const { data, error } = await serviceClient
            .from('linkedin_strategies')
            .insert({
              profile_id: profileId,
              niche,
              target_goal: targetGoal,
              content_pillars: strategy.contentPillars,
              posting_cadence_recommendation: strategy.postingCadenceRecommendation,
              positioning_notes: strategy.positioningNotes,
              headline: strategy.headline,
            })
            .select('id, niche, target_goal, content_pillars, posting_cadence_recommendation, positioning_notes, headline, created_at')
            .single();
          if (error || !data) {
            throw new Error(`Failed to save LinkedIn strategy: ${error?.message}`);
          }
          return mapStrategyRow(data as StrategyRow);
        },
      },
      { profileId: user?.id ?? null, ip, niche, targetGoal }
    );

    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    console.error('LinkedIn strategy generation failed:', err);
    return NextResponse.json({ error: 'Something went wrong building your strategy. Please try again.' }, { status: 500 });
  }
}
