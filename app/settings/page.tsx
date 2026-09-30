'use client';

import { useEffect, useReducer, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AppNav } from '@/components/AppNav';
import { Banner } from '@/components/Banner';
import { PlatformBadge, type BadgePlatform } from '@/components/PlatformBadge';
import { SignInPrompt } from '@/components/SignInPrompt';
import { Switch } from '@/components/Switch';
import { settingsPageReducer, createInitialSettingsPageState } from '@/lib/settings/page-state';

const SECTIONS = [
  { id: 'profile', label: 'Profile' },
  { id: 'security', label: 'Security' },
  { id: 'platforms', label: 'Platforms' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'locale', label: 'Locale' },
  { id: 'billing', label: 'Billing' },
  { id: 'danger', label: 'Danger' },
] as const;

const NOTIF_META = [
  { key: 'recap', label: 'Weekly recap ready', desc: 'When your monthly recap card is generated.' },
  { key: 'ideas', label: 'New content ideas ready', desc: "When this week's ranked ideas are available." },
  { key: 'diagnostic', label: 'Diagnostic finished', desc: 'When a video diagnostic completes.' },
  { key: 'product', label: 'Product & marketing emails', desc: 'Occasional updates and tips.' },
  { key: 'billing', label: 'Payment & billing alerts', desc: 'Failed payments and renewals.' },
] as const;

type NotifKey = (typeof NOTIF_META)[number]['key'];
type Platform = BadgePlatform;

const PLATFORM_NAMES: Record<Platform, string> = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram' };

export default function SettingsPage() {
  const router = useRouter();
  const [state, dispatch] = useReducer(settingsPageReducer, createInitialSettingsPageState());
  const [activeSection, setActiveSection] = useState<string>('profile');

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [displayNameSaved, setDisplayNameSaved] = useState(false);
  const [emailConfirmationSent, setEmailConfirmationSent] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [mfaEnrolling, setMfaEnrolling] = useState<{ factorId: string; qrCode: string; secret: string } | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [notifOn, setNotifOn] = useState<Record<NotifKey, boolean>>({
    recap: true,
    ideas: true,
    diagnostic: true,
    product: false,
    billing: true,
  });
  const [timezone, setTimezone] = useState('America/Los_Angeles');
  const [language, setLanguage] = useState('en-US');
  const [platforms, setPlatforms] = useState<{ tiktok: boolean; instagram: boolean; youtube: boolean } | null>(null);
  const [youtubeHandle, setYoutubeHandle] = useState('');
  const [deleteArmed, setDeleteArmed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/session')
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401) {
          dispatch({ type: 'BOOTSTRAP_UNAUTHORIZED' });
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        if (data.error || typeof data.email !== 'string') {
          dispatch({ type: 'BOOTSTRAP_FAILED' });
          return;
        }
        setDisplayName(data.email.split('@')[0]);
        setEmail(data.email);
        dispatch({ type: 'BOOTSTRAPPED', data: { email: data.email } });
        fetch('/api/settings/profile')
          .then((res) => res.json())
          .then((profileData) => {
            if (typeof profileData.displayName === 'string' && profileData.displayName.length > 0) {
              setDisplayName(profileData.displayName);
            }
          })
          .catch(() => {});
      })
      .catch(() => {
        if (!cancelled) dispatch({ type: 'BOOTSTRAP_FAILED' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (state.status !== 'loaded') return;
    fetch('/api/settings/platforms')
      .then((res) => res.json())
      .then((data) => setPlatforms({ tiktok: Boolean(data.tiktok), instagram: Boolean(data.instagram), youtube: Boolean(data.youtube) }))
      .catch(() => {});
  }, [state.status]);

  useEffect(() => {
    if (state.status !== 'loaded') return;
    fetch('/api/settings/mfa/factors')
      .then((res) => res.json())
      .then((data) => setMfaFactorId(data.factorId ?? null))
      .catch(() => {});
  }, [state.status]);

  async function startMfaEnroll() {
    const res = await fetch('/api/settings/mfa/enroll', { method: 'POST' });
    const data = await res.json();
    if (res.ok) setMfaEnrolling(data);
  }

  async function confirmMfaEnroll() {
    if (!mfaEnrolling) return;
    setMfaError(null);
    const res = await fetch('/api/settings/mfa/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ factorId: mfaEnrolling.factorId, code: mfaCode }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMfaError(data.error ?? 'Something went wrong.');
      return;
    }
    setMfaFactorId(mfaEnrolling.factorId);
    setMfaEnrolling(null);
    setMfaCode('');
  }

  async function disableMfa() {
    if (!mfaFactorId) return;
    setMfaError(null);
    const res = await fetch('/api/settings/mfa/disable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ factorId: mfaFactorId, code: mfaCode }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMfaError(data.error ?? 'Something went wrong.');
      return;
    }
    setMfaFactorId(null);
    setMfaCode('');
  }

  async function disconnectPlatform(platform: 'tiktok' | 'instagram') {
    const res = await fetch(`/api/oauth/${platform}/disconnect`, { method: 'POST' });
    if (res.ok) {
      setPlatforms((prev) => (prev ? { ...prev, [platform]: false } : prev));
    }
  }

  async function saveYoutubeHandle(handle: string) {
    await fetch('/api/settings/platforms/youtube', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle: handle.trim() || null }),
    });
  }

  async function submitMagicLink(magicLinkEmail: string) {
    try {
      const response = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: magicLinkEmail, redirectPath: '/settings' }),
      });
      const data = await response.json();
      if (!response.ok) {
        dispatch({ type: 'MAGIC_LINK_FAILED', error: data.error ?? 'Something went wrong. Please try again.' });
        return;
      }
      dispatch({ type: 'MAGIC_LINK_SENT' });
    } catch {
      dispatch({ type: 'MAGIC_LINK_FAILED', error: "We couldn't reach the server. Check your connection and try again." });
    }
  }

  async function handleSignOut() {
    const response = await fetch('/api/auth/sign-out', { method: 'POST' }).catch(() => null);
    if (!response || !response.ok) return;
    router.push('/');
  }

  if (state.status === 'loading') {
    return <p>Loading…</p>;
  }

  if (
    state.status === 'needsSignIn' ||
    state.status === 'submittingMagicLink' ||
    state.status === 'checkEmail' ||
    state.status === 'magicLinkError'
  ) {
    return (
      <main className="mx-auto flex max-w-md flex-col gap-6 px-6 py-16">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <SignInPrompt
          state={state}
          introCopy="Sign in with a one-time email link to manage your settings."
          returnCopy="Click it to continue and we'll bring you right back here."
          onEmailChange={(value) => dispatch({ type: 'EMAIL_CHANGED', email: value })}
          onSubmitEmail={() => {
            const { email: submittedEmail } = state;
            dispatch({ type: 'SUBMIT_EMAIL' });
            void submitMagicLink(submittedEmail);
          }}
          onResend={() => {
            const { email: submittedEmail } = state;
            dispatch({ type: 'RESEND_EMAIL' });
            void submitMagicLink(submittedEmail);
          }}
          onRetryEmail={() => dispatch({ type: 'RETRY_EMAIL' })}
        />
      </main>
    );
  }

  if (state.status === 'bootstrapFailed') {
    return (
      <>
        <AppNav />
        <p role="alert">We couldn&apos;t load your settings. Please refresh and try again.</p>
      </>
    );
  }

  return (
    <>
      <AppNav />
      <div className="sticky top-0 z-10 border-b border-[#d9d3ee] bg-[#e7e2f6]/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[760px] gap-2 overflow-x-auto px-5 py-3 font-mono text-[11px] uppercase tracking-[.12em]">
          {SECTIONS.map((section) => {
            const active = activeSection === section.id;
            return (
              <a
                key={section.id}
                href={`#${section.id}`}
                onClick={() => setActiveSection(section.id)}
                className={`flex-none whitespace-nowrap rounded-full border px-[13px] py-1.5 ${
                  active ? 'border-[#7c3aed] bg-[#7c3aed] text-white' : 'border-gray-200 bg-white text-gray-600'
                }`}
              >
                {section.label}
              </a>
            );
          })}
        </div>
      </div>

      <main className="mx-auto flex max-w-[760px] flex-col gap-5 px-5 pb-24 pt-[34px]">
        <div>
          <div className="mb-2 font-mono text-[11px] uppercase tracking-[.2em] text-gray-500">Account</div>
          <h1 className="font-heading text-[34px] font-bold leading-[1.05] text-gray-900">Settings</h1>
        </div>

        <Banner variant="info" label="Preview">
          This page previews the redesigned Settings screen. Password and notifications aren&apos;t saved yet. Profile
          details, two-factor authentication, connected platforms, locale, billing, and sign out work normally.
        </Banner>

        <section id="profile" className="flex scroll-mt-16 flex-col gap-[18px] rounded-2xl border border-[#e8e8ee] bg-white p-6">
          <div className="font-mono text-[11px] uppercase tracking-[.16em] text-gray-500">Profile</div>
          <div className="flex items-center gap-4">
            <div
              aria-hidden="true"
              className="flex h-14 w-14 flex-none items-center justify-center rounded-full bg-[#ede9fe] font-heading text-xl font-bold text-[#6d28d9]"
            >
              {email.charAt(0).toUpperCase()}
            </div>
            <button
              type="button"
              className="whitespace-nowrap rounded-full border border-[#7c3aed] px-4 py-2 text-[13px] font-semibold text-[#6d28d9]"
            >
              Upload photo
            </button>
          </div>
          <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-gray-700">
            Display name
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              onBlur={async () => {
                if (!displayName.trim()) return;
                const res = await fetch('/api/settings/profile', {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ displayName }),
                });
                if (res.ok) {
                  setDisplayNameSaved(true);
                  setTimeout(() => setDisplayNameSaved(false), 1700);
                }
              }}
              maxLength={60}
              className="rounded-[10px] border border-[#d8d8e0] px-[14px] py-[10px] font-normal text-gray-900"
            />
            {displayNameSaved && <span className="text-xs text-[#047857]">Saved</span>}
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-gray-700">
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setEmailConfirmationSent(false);
                setEmailError(null);
              }}
              onBlur={async () => {
                if (!email.trim()) return;
                const res = await fetch('/api/settings/email', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ email }),
                });
                const data = await res.json();
                if (!res.ok) {
                  setEmailError(data.error ?? 'Something went wrong.');
                  return;
                }
                setEmailConfirmationSent(true);
              }}
              className="rounded-[10px] border border-[#d8d8e0] px-[14px] py-[10px] font-normal text-gray-900"
            />
            {emailConfirmationSent && (
              <span className="text-xs text-[#047857]">Check your new inbox to confirm the change.</span>
            )}
            {emailError && (
              <span role="alert" className="text-xs text-[#b91c1c]">
                {emailError}
              </span>
            )}
          </label>
        </section>

        <section id="security" className="flex scroll-mt-16 flex-col gap-[18px] rounded-2xl border border-[#e8e8ee] bg-white p-6">
          <div className="font-mono text-[11px] uppercase tracking-[.16em] text-gray-500">Login &amp; security</div>

          <div className="flex flex-col gap-3">
            <p className="text-sm font-semibold text-gray-700">Change password</p>
            <input
              type="password"
              placeholder="Current password"
              disabled
              className="rounded-[10px] border border-[#d8d8e0] px-[14px] py-[10px] disabled:bg-gray-50"
            />
            <input
              type="password"
              placeholder="New password"
              disabled
              className="rounded-[10px] border border-[#d8d8e0] px-[14px] py-[10px] disabled:bg-gray-50"
            />
            <button
              type="button"
              disabled
              className="self-start whitespace-nowrap rounded-full border border-[#7c3aed] px-[18px] py-2 text-[13px] font-semibold text-[#6d28d9] disabled:opacity-50"
            >
              Update password
            </button>
            <p className="text-xs text-gray-500">Password changes aren&apos;t available yet.</p>
          </div>

          <div className="h-px bg-[#eeeef2]" />

          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-semibold text-gray-700">Two-factor authentication</span>
              <span className="text-[13px] leading-[1.45] text-gray-500">
                {mfaFactorId ? 'Enabled — codes via your authenticator app.' : 'Add a second step at sign-in.'}
              </span>
            </div>
            <Switch
              checked={Boolean(mfaFactorId)}
              onChange={() => (mfaFactorId ? setMfaEnrolling({ factorId: mfaFactorId, qrCode: '', secret: '' }) : startMfaEnroll())}
              label="Two-factor authentication"
            />
          </div>
          {mfaEnrolling && (
            <div className="flex flex-col gap-3 rounded-xl border border-[#eeeef2] bg-[#fafafb] p-4">
              {mfaEnrolling.qrCode && (
                <>
                  <p className="text-sm text-gray-700">Scan this code in your authenticator app:</p>
                  <div dangerouslySetInnerHTML={{ __html: mfaEnrolling.qrCode }} />
                  <p className="text-xs text-gray-500">Or enter this key manually: {mfaEnrolling.secret}</p>
                </>
              )}
              <label htmlFor="mfa-confirm-code" className="text-sm font-medium text-gray-700">
                Verification code
              </label>
              <input
                id="mfa-confirm-code"
                type="text"
                inputMode="numeric"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                className="rounded-lg border border-gray-300 px-4 py-2"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={mfaFactorId === mfaEnrolling.factorId ? disableMfa : confirmMfaEnroll}
                  className="rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white"
                >
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMfaEnrolling(null);
                    setMfaCode('');
                    setMfaError(null);
                  }}
                  className="rounded-full border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700"
                >
                  Cancel
                </button>
              </div>
              {mfaError && (
                <p role="alert" className="text-sm text-red-600">
                  {mfaError}
                </p>
              )}
            </div>
          )}

          <div className="h-px bg-[#eeeef2]" />

          <div className="flex flex-col gap-3">
            <p className="text-sm font-semibold text-gray-700">Session</p>
            <div className="flex items-center justify-between gap-3 rounded-[10px] border border-[#eeeef2] bg-[#fafafb] px-[14px] py-[11px]">
              <span className="text-[13px] font-semibold text-gray-700">You&apos;re signed in on this device.</span>
              <span className="flex-none whitespace-nowrap rounded-full border border-[#a7f3d0] bg-[#d1fae5] px-[9px] py-[3px] font-mono text-[10px] uppercase tracking-[.1em] text-[#047857]">
                Current
              </span>
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              className="self-start whitespace-nowrap rounded-full border border-[#f0c8c2] px-[18px] py-2 text-[13px] font-semibold text-[#b91c1c]"
            >
              Sign out
            </button>
          </div>
        </section>

        <section id="platforms" className="flex scroll-mt-16 flex-col gap-4 rounded-2xl border border-[#e8e8ee] bg-white p-6">
          <div className="font-mono text-[11px] uppercase tracking-[.16em] text-gray-500">Connected platforms</div>
          {(['youtube', 'tiktok', 'instagram'] as const).map((platform) => {
            const connected = platforms?.[platform] ?? false;
            if (platform === 'youtube') {
              return (
                <div
                  key={platform}
                  className="flex items-center justify-between gap-3.5 rounded-xl border border-[#eeeef2] bg-[#fafafb] px-4 py-3.5"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <PlatformBadge platform={platform} />
                    <label className="flex min-w-0 flex-col gap-0.5 text-sm font-semibold text-gray-700">
                      YouTube handle
                      <input
                        type="text"
                        defaultValue={youtubeHandle}
                        onChange={(e) => setYoutubeHandle(e.target.value)}
                        onBlur={(e) => saveYoutubeHandle(e.target.value)}
                        placeholder="@channel"
                        className="rounded-md border border-[#d8d8e0] px-2 py-1 text-sm font-normal text-gray-900"
                      />
                    </label>
                  </div>
                  <span className={`font-mono text-[11px] tracking-[.04em] ${connected ? 'text-[#047857]' : 'text-gray-500'}`}>
                    {connected ? 'Connected' : 'Not connected'}
                  </span>
                </div>
              );
            }
            return (
              <div
                key={platform}
                className="flex items-center justify-between gap-3.5 rounded-xl border border-[#eeeef2] bg-[#fafafb] px-4 py-3.5"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <PlatformBadge platform={platform} />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm font-semibold text-gray-700">{PLATFORM_NAMES[platform]}</span>
                    <span className={`font-mono text-[11px] tracking-[.04em] ${connected ? 'text-[#047857]' : 'text-gray-500'}`}>
                      {connected ? 'Connected' : 'Not connected'}
                    </span>
                  </div>
                </div>
                {connected ? (
                  <button
                    type="button"
                    onClick={() => disconnectPlatform(platform)}
                    className="flex-none whitespace-nowrap rounded-full border border-[#d8d8e0] px-4 py-2 text-[13px] font-semibold text-[#6d28d9]"
                  >
                    Disconnect
                  </button>
                ) : (
                  <a
                    href={`/api/oauth/${platform}/authorize`}
                    className="flex-none whitespace-nowrap rounded-full bg-brand px-4 py-2 text-[13px] font-semibold text-white"
                  >
                    Connect
                  </a>
                )}
              </div>
            );
          })}
        </section>

        <section id="notifications" className="flex scroll-mt-16 flex-col gap-1.5 rounded-2xl border border-[#e8e8ee] bg-white p-6">
          <div className="mb-2 font-mono text-[11px] uppercase tracking-[.16em] text-gray-500">Notifications &amp; email</div>
          {NOTIF_META.map((notif) => (
            <div
              key={notif.key}
              className="flex items-center justify-between gap-4 border-t border-[#f2f2f5] py-[11px] first:border-t-0"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-semibold text-gray-700">{notif.label}</span>
                <span className="text-[13px] leading-[1.4] text-gray-500">{notif.desc}</span>
              </div>
              <Switch
                checked={notifOn[notif.key]}
                onChange={() => setNotifOn((prev) => ({ ...prev, [notif.key]: !prev[notif.key] }))}
                label={notif.label}
              />
            </div>
          ))}
        </section>

        <section id="locale" className="flex scroll-mt-16 flex-col gap-4 rounded-2xl border border-[#e8e8ee] bg-white p-6">
          <div className="font-mono text-[11px] uppercase tracking-[.16em] text-gray-500">Timezone &amp; locale</div>
          <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-gray-700">
            Timezone
            <select
              value={timezone}
              onChange={async (e) => {
                setTimezone(e.target.value);
                await fetch('/api/settings/locale', {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ timezone: e.target.value }),
                });
              }}
              className="rounded-[10px] border border-[#d8d8e0] px-[14px] py-[10px] font-normal text-gray-900"
            >
              <option value="America/Los_Angeles">(GMT-08:00) Pacific Time</option>
              <option value="America/New_York">(GMT-05:00) Eastern Time</option>
              <option value="Europe/London">(GMT+00:00) London</option>
              <option value="Europe/Berlin">(GMT+01:00) Central European Time</option>
              <option value="Asia/Tokyo">(GMT+09:00) Tokyo</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-gray-700">
            Language
            <select
              value={language}
              onChange={async (e) => {
                setLanguage(e.target.value);
                await fetch('/api/settings/locale', {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ locale: e.target.value }),
                });
              }}
              className="rounded-[10px] border border-[#d8d8e0] px-[14px] py-[10px] font-normal text-gray-900"
            >
              <option value="en-US">English (US)</option>
              <option value="en-GB">English (UK)</option>
              <option value="es-ES">Español</option>
              <option value="pt-BR">Português (Brasil)</option>
              <option value="de-DE">Deutsch</option>
            </select>
          </label>
        </section>

        <section
          id="billing"
          className="flex scroll-mt-16 flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#e8e8ee] bg-white p-6"
        >
          <div className="flex min-w-0 flex-col gap-1">
            <div className="font-mono text-[11px] uppercase tracking-[.16em] text-gray-500">Billing &amp; subscription</div>
            <span className="text-sm text-gray-600">Manage your plan, payment method, and invoices.</span>
          </div>
          <Link
            href="/billing"
            className="flex-none whitespace-nowrap rounded-full bg-brand px-5 py-[11px] text-[13px] font-semibold text-white"
          >
            Open billing
          </Link>
        </section>

        <section id="danger" className="flex scroll-mt-16 flex-col gap-3.5 rounded-2xl border border-[#f3d3cd] bg-white p-6">
          <div className="font-mono text-[11px] uppercase tracking-[.16em] text-[#b91c1c]">Delete account</div>
          <p className="text-sm leading-[1.5] text-gray-600">
            Permanently delete your account and all diagnostics, recaps, and saved ideas. This can&apos;t be undone.
          </p>
          {deleteArmed ? (
            <div className="flex flex-col gap-3 rounded-xl border border-[#f7cfc8] border-t-2 border-t-[#ef4444] bg-gradient-to-br from-[#fef2f2] to-[#fde4e0] px-4 py-[15px]">
              <p className="text-sm leading-[1.5] text-[#1f2937]">
                Account deletion isn&apos;t available yet in this preview — contact support to delete your account.
              </p>
              <button
                type="button"
                onClick={() => setDeleteArmed(false)}
                className="self-start whitespace-nowrap rounded-full border border-[#d8d8e0] bg-white px-[18px] py-2.5 text-[13px] font-semibold text-gray-700"
              >
                Close
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setDeleteArmed(true)}
              className="self-start whitespace-nowrap rounded-full border border-[#f0c8c2] px-[18px] py-2.5 text-[13px] font-semibold text-[#b91c1c]"
            >
              Delete account
            </button>
          )}
        </section>
      </main>
    </>
  );
}
