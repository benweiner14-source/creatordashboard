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
        Understand your content, in plain English.
      </h1>
      <p className="text-lg text-gray-600">
        Paste a link to a video or post and get a report on your hook, your retention risk,
        your posting timing, and your format fit &mdash; explained in words you actually
        understand, not jargon.
      </p>
      <Link
        href="/diagnostic"
        className="rounded-full bg-indigo-600 px-8 py-3 text-lg font-semibold text-white hover:bg-indigo-700"
      >
        Run a free diagnostic
      </Link>
      <Link href="/recap" className="text-indigo-700 underline">
        Get your monthly recap card
      </Link>
      <Link href="/ideas" className="text-indigo-700 underline">
        Get weekly content ideas
      </Link>
      <Link href="/strategy" className="text-indigo-700 underline">
        Break down a channel you admire
      </Link>
    </main>
  );
}
