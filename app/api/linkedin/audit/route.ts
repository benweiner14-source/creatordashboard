import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { createSupabaseRateLimitStore } from '@/lib/supabase/rate-limit-store';
import { createLinkedInAuditClient } from '@/lib/integrations/claude-linkedin-audit';
import { deriveClientIp } from '@/lib/ip';
import { handleLinkedInAuditRequest } from '@/lib/linkedin/audit-handler';
import { hasActiveSubscription } from '@/lib/billing/entitlements';
import type { SavedLinkedInAudit } from '@/lib/linkedin/audit-handler';

const MAX_PDF_BYTES = 10 * 1024 * 1024;

interface AuditRow {
  id: string;
  headline: string;
  working_well: unknown;
  needs_work: unknown;
  created_at: string;
}

function mapAuditRow(row: AuditRow): SavedLinkedInAudit {
  return {
    id: row.id,
    headline: row.headline,
    workingWell: row.working_well as string[],
    needsWork: row.needs_work as string[],
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
    .from('linkedin_profile_audits')
    .select('id, headline, working_well, needs_work, created_at')
    .eq('profile_id', user.id)
    .order('created_at', { ascending: false })
    .limit(10);

  return NextResponse.json({ ok: true, history: (rows ?? []).map((row) => mapAuditRow(row as AuditRow)) });
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('pdf');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Upload a PDF of your LinkedIn profile first.' }, { status: 400 });
    }
    if (file.type !== 'application/pdf') {
      return NextResponse.json({ error: "That file isn't a PDF. Export your profile as a PDF and try again." }, { status: 400 });
    }
    if (file.size > MAX_PDF_BYTES) {
      return NextResponse.json({ error: 'That PDF is too large (10MB max). Try exporting just your profile page.' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const pdfBase64 = buffer.toString('base64');

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

    const result = await handleLinkedInAuditRequest(
      {
        rateLimitStore: createSupabaseRateLimitStore(serviceClient),
        linkedInAuditClient: createLinkedInAuditClient(process.env.ANTHROPIC_API_KEY ?? ''),
        ipSalt: process.env.RATE_LIMIT_IP_SALT ?? 'dev-salt',
        hasActiveSubscription: (profileId) => hasActiveSubscription(serviceClient, profileId),
        saveAudit: async ({ profileId, audit }) => {
          const { data, error } = await serviceClient
            .from('linkedin_profile_audits')
            .insert({ profile_id: profileId, headline: audit.headline, working_well: audit.workingWell, needs_work: audit.needsWork })
            .select('id, headline, working_well, needs_work, created_at')
            .single();
          if (error || !data) {
            throw new Error(`Failed to save LinkedIn profile audit: ${error?.message}`);
          }
          return mapAuditRow(data as AuditRow);
        },
      },
      { profileId: user?.id ?? null, ip, pdfBase64 }
    );

    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    console.error('LinkedIn profile audit failed:', err);
    return NextResponse.json({ error: 'Something went wrong running your profile audit. Please try again.' }, { status: 500 });
  }
}
