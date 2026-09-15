import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';

// Named MarketingPage, not HomePage, to keep it distinct from app/home/page.tsx's
// HomePage export — the two are entirely different pages.
export default async function MarketingPage() {
  // Before a real Supabase project is connected, these env vars are unset.
  // createSupabaseServerClient() throws immediately in that state (same
  // failure proxy.ts's own guard exists to prevent for every other page —
  // see its comment). This page is the one guaranteed-browsable page in
  // the app; it must not 500 just because sign-in isn't configured yet.
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      redirect('/home');
    }
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col items-center gap-6 px-6 py-24 text-center">
      <h1 className="text-4xl font-bold text-gray-900">
        GTA 6 is about to be the biggest launch gaming has ever seen.
      </h1>
      <p className="text-lg text-gray-600">
        The creators who build their audience now &mdash; before launch &mdash; will own this niche
        for years. Creator Dashboard gives you weekly GTA 6 content ideas, a shareable recap of your
        growth, a breakdown of any channel&apos;s strategy, and a watchlist on who&apos;s already ahead.
      </p>
      <Link
        href="/ideas"
        className="rounded-full bg-indigo-600 px-8 py-3 text-lg font-semibold text-white hover:bg-indigo-700"
      >
        Get this week&apos;s GTA 6 content ideas
      </Link>
      <Link href="/recap" className="text-indigo-700 underline">
        Track your GTA 6 channel&apos;s growth every month
      </Link>
      <Link href="/strategy" className="text-indigo-700 underline">
        Break down any GTA 6 creator&apos;s strategy
      </Link>
      <Link href="/watchlist" className="text-indigo-700 underline">
        See who&apos;s already ahead &mdash; track GTA 6 creators
      </Link>
    </main>
  );
}
