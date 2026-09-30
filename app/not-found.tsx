import Link from 'next/link';
import { AppNav } from '@/components/AppNav';

export default function NotFound() {
  return (
    <>
      <AppNav />
      <main className="mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-24 text-center">
        <h1 className="text-2xl font-bold text-gray-900">We couldn&apos;t find that page</h1>
        <p className="text-gray-600">
          The link may be out of date, or the page may have moved. Let&apos;s get you back on track.
        </p>
        <Link href="/" className="rounded-full bg-indigo-600 px-6 py-3 font-semibold text-white hover:bg-indigo-700">
          Back to Home
        </Link>
      </main>
    </>
  );
}
