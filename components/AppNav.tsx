// components/AppNav.tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Banner } from '@/components/Banner';

const NAV_LINKS = [
  { href: '/home', label: 'Home' },
  { href: '/warroom', label: 'War Room' },
  { href: '/recap', label: 'Recap' },
  { href: '/ideas', label: 'Ideas' },
  { href: '/strategy', label: 'Strategy' },
  { href: '/watchlist', label: 'Watchlist' },
  { href: '/billing', label: 'Billing' },
] as const;

export function AppNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // Mirrors app/settings/page.tsx's own justCancelledDeletion state: a
  // one-time notice for the current page load, not persisted anywhere, so
  // it naturally goes away on the next navigation or reload. AppNav mounts
  // on every authenticated page (not just Settings), so this is the only
  // place a user who signs back in anywhere else learns that their pending
  // account deletion was just auto-cancelled.
  const [justCancelledDeletion, setJustCancelledDeletion] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/session')
      .then(async (res) => {
        if (cancelled || !res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setEmail(data.email ?? null);
        if (data.justCancelledDeletion) {
          setJustCancelledDeletion(true);
        }
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
    <div className="relative">
      {justCancelledDeletion && (
        <div className="px-2 pt-4 sm:px-4">
          <Banner variant="positive" label="Welcome back">
            Your account deletion was canceled.
          </Banner>
        </div>
      )}
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
          <Link
            href="/settings"
            aria-label="Settings"
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-700"
          >
            {initial}
          </Link>
          {/* Below `sm` the link list above never renders at all — this toggle
              is the only way a signed-in phone user reaches anything besides
              /home, so it (and the dropdown it opens) is the mobile nav, not a
              cosmetic extra. */}
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav-menu"
            aria-label="Toggle menu"
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-900 sm:hidden"
          >
            <span aria-hidden="true" className="text-lg leading-none">
              {menuOpen ? '✕' : '☰'}
            </span>
          </button>
        </div>
      </nav>
      {menuOpen && (
        <ul
          id="mobile-nav-menu"
          data-testid="mobile-nav-menu"
          className="absolute right-2 top-full z-20 flex w-48 flex-col gap-1 rounded-lg border border-gray-200 bg-white p-2 text-sm shadow-lg sm:hidden"
        >
          {NAV_LINKS.map((link) => {
            const active = pathname === link.href;
            return (
              <li key={link.href}>
                <Link
                  href={link.href}
                  onClick={() => setMenuOpen(false)}
                  aria-current={active ? 'page' : undefined}
                  className={
                    active
                      ? 'block rounded-md bg-indigo-50 px-3 py-2 font-semibold text-indigo-700'
                      : 'block rounded-md px-3 py-2 text-gray-700 hover:bg-gray-50'
                  }
                >
                  {link.label}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
