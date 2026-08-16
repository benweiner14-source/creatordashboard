// app/home/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppNav } from '@/components/AppNav';
import { HomeCard } from '@/components/HomeCard';
import { PlatformBadge, type BadgePlatform } from '@/components/PlatformBadge';
import { ScoreRing } from '@/components/ScoreRing';
import { formatCompactNumber, formatRelativeDays } from '@/lib/home/format';
import { deriveDisplayNameFromEmail } from '@/lib/home/display-name';
import type { HomeData } from '@/lib/home/types';
import type { RecapPlatform } from '@/lib/recap/types';

const RING_COLORS = ['#4338ca', '#7c3aed', '#4338ca', '#7c3aed'] as const;
const RECAP_PLATFORM_ORDER: RecapPlatform[] = ['youtube', 'tiktok', 'instagram'];

export default function HomePage() {
  const router = useRouter();
  const [data, setData] = useState<HomeData | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/home')
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401) {
          router.push('/');
          return;
        }
        const json = await res.json();
        if (cancelled) return;
        if (json.error) {
          setLoadFailed(true);
          return;
        }
        setData(json as HomeData);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (loadFailed) {
    return <p role="alert">We couldn&apos;t load your dashboard. Please refresh and try again.</p>;
  }

  if (!data) {
    return <p>Loading…</p>;
  }

  const displayName = deriveDisplayNameFromEmail(data.email);

  return (
    <div className="mx-auto max-w-6xl rounded-[28px] bg-[#fdfcff] shadow-[0_30px_70px_-28px_rgba(58,46,143,0.28)]">
      <AppNav />

      <header className="mx-4 mt-1 rounded-[22px] bg-[linear-gradient(120deg,#4338ca_0%,#6229c9_46%,#9333ea_100%)] px-8 py-10 text-[#f4f2ff] sm:mx-6">
        <h1 className="font-serif text-3xl font-normal">Welcome back, {displayName}.</h1>
        <p className="mt-2 max-w-md text-[#e4defc]">Here&apos;s how your tools are looking this week.</p>
      </header>

      <main className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-3">
        <DiagnosticCard diagnostic={data.diagnostic} />
        <RecapCard recap={data.recap} />
        <IdeasCard ideas={data.ideas} />
      </main>
    </div>
  );
}

function DiagnosticCard({ diagnostic }: { diagnostic: HomeData['diagnostic'] }) {
  if (!diagnostic) {
    return (
      <HomeCard variant="cta" ariaLabelledBy="diagnostic-cta-heading">
        <h3 id="diagnostic-cta-heading" className="font-serif text-xl font-normal">
          Run your first diagnostic
        </h3>
        <p className="text-sm text-white/90">
          Paste a link and get a plain-English breakdown of your hook, retention, timing, and format — takes under a
          minute.
        </p>
        <a
          href="/diagnostic"
          className="mt-auto self-start rounded-full bg-white px-5 py-2.5 text-sm font-bold text-indigo-900"
        >
          Run a diagnostic
        </a>
      </HomeCard>
    );
  }

  const rings: Array<{ key: string; label: string; value: number }> = [
    { key: 'hook', label: 'Hook', value: diagnostic.hookStrengthScore },
    { key: 'retention', label: 'Retention', value: diagnostic.retentionRiskScore },
    { key: 'timing', label: 'Timing', value: diagnostic.timingScore },
    { key: 'format', label: 'Format', value: diagnostic.formatFitScore },
  ];

  return (
    <HomeCard ariaLabelledBy="diagnostic-heading">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <PlatformBadge platform={diagnostic.platform as BadgePlatform} />
          <h3 id="diagnostic-heading" className="font-bold text-gray-900">
            Latest diagnostic
          </h3>
        </div>
      </div>

      <p className="text-4xl font-bold tracking-tight text-gray-900">
        {diagnostic.overallScore}
        <span className="ml-1 text-lg font-medium text-gray-400">/100</span>
      </p>

      <div
        role="img"
        aria-label={rings.map((r) => `${r.label} ${Math.round(r.value)}`).join(', ')}
        className="flex flex-wrap gap-3"
      >
        {rings.map((ring, i) => (
          <ScoreRing key={ring.key} value={ring.value} label={ring.label} color={RING_COLORS[i]} />
        ))}
      </div>

      <div className="mt-auto flex items-center justify-between gap-3">
        <span className="text-xs text-gray-400">Checked {formatRelativeDays(new Date(diagnostic.createdAt), new Date())}</span>
        <a href="/diagnostic" className="text-sm font-semibold text-indigo-900">
          Run another →
        </a>
      </div>
    </HomeCard>
  );
}

function RecapCard({ recap }: { recap: HomeData['recap'] }) {
  if (!recap) {
    return (
      <HomeCard variant="cta" ariaLabelledBy="recap-cta-heading">
        <h3 id="recap-cta-heading" className="font-serif text-xl font-normal">
          Generate this month&apos;s recap
        </h3>
        <p className="text-sm text-white/90">Connect a platform once, then get a shareable card of this month&apos;s stats.</p>
        <a
          href="/recap"
          className="mt-auto self-start rounded-full bg-white px-5 py-2.5 text-sm font-bold text-indigo-900"
        >
          Get my recap
        </a>
      </HomeCard>
    );
  }

  const platformEntries = RECAP_PLATFORM_ORDER.filter((p) => recap.platformData[p]);

  return (
    <HomeCard ariaLabelledBy="recap-heading">
      <div className="flex items-center gap-1">
        {platformEntries.map((p, i) => (
          <span key={p} className={i > 0 ? '-ml-2' : ''}>
            <PlatformBadge platform={p as BadgePlatform} />
          </span>
        ))}
        <h3 id="recap-heading" className="ml-2 font-bold text-gray-900">
          Recap
        </h3>
      </div>

      <p className="text-4xl font-bold tracking-tight text-gray-900">
        {formatCompactNumber(recap.totals.views)}
        <span className="ml-1 text-lg font-medium text-gray-400">views</span>
      </p>

      <div className="flex flex-col gap-1.5">
        {platformEntries.map((p) => {
          const stats = recap.platformData[p]!;
          const share = recap.totals.views > 0 ? Math.round((stats.views / recap.totals.views) * 100) : 0;
          return (
            <div key={p} className="flex items-center gap-2 text-xs text-gray-500">
              <span className="w-16 flex-shrink-0 capitalize">{p}</span>
              <span className="h-1.5 flex-1 rounded-full bg-gray-100">
                <span className="block h-1.5 rounded-full bg-indigo-500" style={{ width: `${share}%` }} />
              </span>
              <span className="w-12 flex-shrink-0 text-right">{formatCompactNumber(stats.views)}</span>
            </div>
          );
        })}
      </div>

      <p className="text-sm text-gray-600">
        Top post: <strong>&ldquo;{recap.topPost.captionOrTitle}&rdquo;</strong> · {formatCompactNumber(recap.topPost.viewCount)} views
      </p>

      <div className="mt-auto flex items-center justify-between gap-3">
        <span className="text-xs text-gray-400">
          Updated {new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(recap.generatedAt))}
        </span>
        <a href="/recap" className="text-sm font-semibold text-indigo-900">
          View full recap →
        </a>
      </div>
    </HomeCard>
  );
}

function IdeasCard({ ideas }: { ideas: HomeData['ideas'] }) {
  if (!ideas.niche) {
    return (
      <HomeCard variant="cta" ariaLabelledBy="ideas-cta-heading">
        <h3 id="ideas-cta-heading" className="font-serif text-xl font-normal">
          Set your niche to get this week&apos;s ideas
        </h3>
        <p className="text-sm text-white/90">Takes 10 seconds — we&apos;ll research what&apos;s trending for you every Monday.</p>
        <a
          href="/ideas"
          role="button"
          className="mt-auto self-start rounded-full bg-white px-5 py-2.5 text-sm font-bold text-indigo-900"
        >
          Set my niche
        </a>
      </HomeCard>
    );
  }

  if (!ideas.digest) {
    return (
      <HomeCard variant="cta" ariaLabelledBy="ideas-cta-heading">
        <h3 id="ideas-cta-heading" className="font-serif text-xl font-normal">
          Get this week&apos;s ideas
        </h3>
        <p className="text-sm text-white/90">We&apos;ll research what&apos;s trending for {ideas.niche} right now.</p>
        <a
          href="/ideas"
          role="button"
          className="mt-auto self-start rounded-full bg-white px-5 py-2.5 text-sm font-bold text-indigo-900"
        >
          Get my ideas
        </a>
      </HomeCard>
    );
  }

  return (
    <HomeCard ariaLabelledBy="ideas-heading">
      <h3 id="ideas-heading" className="font-bold text-gray-900">
        This week&apos;s ideas
      </h3>
      <p className="text-sm text-gray-700">{ideas.digest.firstIdeaTitle}</p>
      {ideas.digest.ideaCount > 1 && (
        <p className="text-xs text-gray-400">+{ideas.digest.ideaCount - 1} more</p>
      )}
      <div className="mt-auto flex justify-end">
        <a href="/ideas" className="text-sm font-semibold text-indigo-900">
          View all ideas →
        </a>
      </div>
    </HomeCard>
  );
}
