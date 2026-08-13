import { ImageResponse } from 'next/og';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const PLATFORM_LABELS: Record<string, string> = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram' };

function formatCompactNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Public by design — see the identical comment in
  // app/api/recap/[id]/route.ts. This is the URL a creator posts directly
  // to their own social feed; it must render for anonymous viewers.
  const supabase = createSupabaseServiceRoleClient();
  const { data, error } = await supabase.from('recap_cards').select('*').eq('id', id).single();

  if (error || !data) {
    return new Response('Recap card not found', { status: 404 });
  }

  const monthLabel = new Date(data.month).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const totals = data.totals as { views: number; likes: number; postCount: number };
  const topPost = data.top_post as { platform: string; captionOrTitle: string; viewCount: number };
  const platformData = data.platform_data as Record<string, { views: number }>;

  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          backgroundColor: '#4338ca',
          padding: '64px',
          color: 'white',
          fontFamily: 'sans-serif',
        }}
      >
        {/* Satori rejects any <div> with more than one child node unless it
            declares display: flex/contents/none, and JSX turns interleaved
            {expression}/text into multiple children. Every text line below is
            therefore a single template-literal child. */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 28, opacity: 0.8 }}>{`${monthLabel} Recap`}</div>
          <div style={{ fontSize: 96, fontWeight: 700, marginTop: 12 }}>
            {`${formatCompactNumber(totals.views)} views`}
          </div>
          <div style={{ fontSize: 28, marginTop: 8, opacity: 0.9 }}>
            {`${formatCompactNumber(totals.postCount)} posts · ${formatCompactNumber(totals.likes)} likes`}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 22, opacity: 0.8 }}>Top post</div>
          <div style={{ fontSize: 30, fontWeight: 600 }}>
            {`${PLATFORM_LABELS[topPost.platform] ?? topPost.platform} · ${formatCompactNumber(topPost.viewCount)} views`}
          </div>
          <div style={{ fontSize: 22, opacity: 0.85, maxWidth: 900 }}>{topPost.captionOrTitle.slice(0, 90)}</div>
        </div>
        <div style={{ display: 'flex', gap: 24 }}>
          {Object.entries(platformData).map(([platform, stats]) => (
            <div key={platform} style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: 18, opacity: 0.75 }}>{PLATFORM_LABELS[platform] ?? platform}</div>
              <div style={{ fontSize: 26, fontWeight: 600 }}>{formatCompactNumber(stats.views)}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 20, opacity: 0.6 }}>Creator Dashboard</div>
      </div>
    ),
    {
      width: 1080,
      height: 1350,
      // The underlying recap_cards row is immutable once generated, and this
      // is the URL embedded in every share — cache it hard.
      headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
    }
  );
}
