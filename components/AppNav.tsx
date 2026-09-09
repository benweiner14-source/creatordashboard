// components/AppNav.tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

const NAV_LINKS = [
  { href: '/home', label: 'Home' },
  { href: '/diagnostic', label: 'Diagnostic' },
  { href: '/recap', label: 'Recap' },
  { href: '/ideas', label: 'Ideas' },
  { href: '/strategy', label: 'Strategy' },
  { href: '/linkedin', label: 'LinkedIn' },
  { href: '/billing', label: 'Billing' },
] as const;

export function AppNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/session')
      .then(async (res) => {
        if (cancelled || !res.ok) return;
        const data = await res.json();
        if (!cancelled) setEmail(data.email ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSignOut() {
    const response = await fetch('/api/auth/sign-out', { method: 'POST' }).catch(() => null);
    // If sign-out failed the session cookie is still valid, so navigating to '/'
    // would just bounce straight back to /home with the user still signed in.
    // Staying put is the honest outcome.
    if (!response || !response.ok) return;
    router.push('/');
  }

  if (!email) return null;

  const initial = email.charAt(0).toUpperCase();

  return (
    <nav aria-label="Primary" className="flex items-center justify-between gap-6 px-2 py-4 sm:px-4">
      <Link href="/home" className="flex items-center gap-2 text-base font-bold text-gray-900">
        <span aria-hidden="true" className="h-6 w-6 rounded-lg bg-[linear-gradient(135deg,#4338ca,#7c3aed)]" />
        Creator Dashboard
      </Link>
      <ul className="hidden items-center gap-7 text-sm sm:flex">
        {NAV_LINKS.map((link) => {
          const active = pathname === link.href;
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                aria-current={active ? 'page' : undefined}
                className={
                  active
                    ? 'border-b-2 border-indigo-600 pb-1 font-semibold text-gray-900'
                    : 'pb-1 text-gray-500 hover:text-gray-900'
                }
              >
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="flex items-center gap-3">
        {/* The identity chip is never gated behind a responsive `hidden` wrapper:
            below `sm` the nav link row collapses (a stated spec non-goal), which
            would otherwise leave a signed-in mobile user with no way to sign out
            at all — and `/` now redirects them straight back to /home. Only the
            email text is hidden at narrow widths; the button always renders. */}
        <div className="flex flex-col text-right leading-tight">
          <span className="hidden text-sm font-semibold text-gray-900 sm:block">{email}</span>
          <button type="button" onClick={handleSignOut} className="text-xs text-gray-400 hover:text-gray-600">
            Sign out
          </button>
        </div>
        <div
          aria-hidden="true"
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-700"
        >
          {initial}
        </div>
      </div>
    </nav>
  );
}
