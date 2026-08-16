import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { createSupabaseRateLimitStore } from '@/lib/supabase/rate-limit-store';
import { createClaudeContentIdeasClient } from '@/lib/integrations/claude-ideas';
import { deriveClientIp } from '@/lib/ip';
import { handleIdeasRequest, weekStartKey } from '@/lib/ideas/handler';
import type { WeeklyDigestRow } from '@/lib/ideas/handler';
import type { ContentIdea } from '@/lib/integrations/claude-ideas';

function mapDigestRow(row: { id: string; profile_id: string; week_start: string; content_ideas: unknown }): WeeklyDigestRow {
  return {
    id: row.id,
    profileId: row.profile_id,
    weekStart: row.week_start,
    contentIdeas: row.content_ideas as ContentIdea[],
  };
}

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'You must be signed in to view your content ideas.' }, { status: 401 });
  }

  const serviceClient = createSupabaseServiceRoleClient();
  const { data: profile } = await serviceClient
    .from('profiles')
    .select('niche, digest_email_opt_in')
    .eq('id', user.id)
    .single();

  const { data: existingDigest } = await serviceClient
    .from('weekly_digests')
    .select('*')
    .eq('profile_id', user.id)
    .eq('week_start', weekStartKey(new Date()))
    .maybeSingle();

  return NextResponse.json({
    niche: profile?.niche ?? null,
    digestEmailOptIn: profile?.digest_email_opt_in ?? false,
    digest: existingDigest ? mapDigestRow(existingDigest) : null,
  });
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

    const result = await handleIdeasRequest(
      {
        rateLimitStore: createSupabaseRateLimitStore(serviceClient),
        contentIdeasClient: createClaudeContentIdeasClient(process.env.ANTHROPIC_API_KEY ?? ''),
        ipSalt: process.env.RATE_LIMIT_IP_SALT ?? 'dev-salt',
        getProfileNiche: async (profileId) => {
          const { data } = await serviceClient.from('profiles').select('niche').eq('id', profileId).single();
          return data?.niche ?? null;
        },
        getExistingDigest: async (profileId, weekStart) => {
          const { data } = await serviceClient
            .from('weekly_digests')
            .select('*')
            .eq('profile_id', profileId)
            .eq('week_start', weekStart)
            .maybeSingle();
          return data ? mapDigestRow(data) : null;
        },
        saveDigest: async ({ profileId, weekStart, contentIdeas }) => {
          const { data, error } = await serviceClient
            .from('weekly_digests')
            .insert({ profile_id: profileId, week_start: weekStart, content_ideas: contentIdeas })
            .select('*')
            .single();
          if (error || !data) {
            throw new Error(`Failed to save weekly digest: ${error?.message}`);
          }
          return mapDigestRow(data);
        },
      },
      { profileId: user?.id ?? null, ip, now: new Date() }
    );

    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    console.error('Content ideas generation failed:', err);
    return NextResponse.json({ error: 'Something went wrong generating your content ideas. Please try again.' }, { status: 500 });
  }
}
