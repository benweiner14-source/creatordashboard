# Dashboard Home Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/home` — a unified, signed-in landing page summarizing Diagnostic, Recap Card, and Weekly Content Ideas — plus a shared nav bar across all four signed-in pages.

**Architecture:** A new `GET /api/home` route aggregates read-only summaries from the three existing tables (`diagnostics`, `recap_cards`, `weekly_digests`) behind a thin `app/home/page.tsx` client bootstrap, matching this app's established pattern (see `app/api/recap/route.ts`, `app/api/ideas/route.ts`). A new `<AppNav>` component (self-fetching its own identity via a new `GET /api/session` route) is mounted on `/home`, `/diagnostic`, `/recap`, and `/ideas`. A new `POST /api/auth/sign-out` route backs the nav's sign-out action. `/` becomes an async server component that redirects a signed-in visitor straight to `/home`.

**Tech Stack:** Next.js App Router + TypeScript + Tailwind (utility classes, arbitrary values for one-off gradients/shadows — no new CSS files), Supabase, Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-16-dashboard-home-design.md`

## Global Constraints

- No new tables or columns — every value on `/home` is read from `profiles`, `diagnostics`, `recap_cards`, `weekly_digests`, or `auth.getUser()`.
- No fabricated data — the Recap card's per-platform view-share bars (§7.2 of the spec) replace the mockup's illustrative sparkline because `recap_cards` has no weekly time series.
- Styling is Tailwind utility classes (with arbitrary-value syntax for gradients/shadows) — no custom CSS files, matching every existing page in this app.
- `GET /api/home`, like the existing `GET /api/recap` and `GET /api/ideas`, gets no dedicated unit test (no branching logic to isolate) — it's covered by the Playwright smoke test in the final task, matching established precedent in this codebase.
- `<AppNav>` always sources identity via its own `GET /api/session` fetch (never a threaded prop) — a deliberate simplicity trade over threading identity through four different bootstrap payloads, at the cost of one extra lightweight request per page load.

---

## File Structure

```
lib/home/
  format.ts                # formatRelativeDays, formatCompactNumber (pure)
  display-name.ts           # deriveDisplayNameFromEmail (pure)
  types.ts                  # HomeData and friends — shared by the route and the page

app/api/
  session/route.ts          # GET — { email } | 401, powers <AppNav>
  auth/sign-out/route.ts    # POST — signs out, clears the session cookie
  home/route.ts             # GET — aggregates diagnostic/recap/ideas summaries

components/
  PlatformBadge.tsx          # colored platform icon circle (YouTube/TikTok/Instagram)
  ScoreRing.tsx               # SVG ring mini-chart for one 0-100 score
  HomeCard.tsx                 # shared card shell (default + gradient "cta" variant)
  AppNav.tsx                   # shared nav bar, self-fetches identity

app/
  home/page.tsx              # the new dashboard home page
  page.tsx                   # MODIFIED — becomes an async server component, redirects signed-in visitors

  recap/page.tsx             # MODIFIED — mounts <AppNav />
  ideas/page.tsx              # MODIFIED — mounts <AppNav />
  diagnostic/page.tsx          # MODIFIED — mounts <AppNav />

tests/unit/
  lib/home/format.test.ts
  lib/home/display-name.test.ts
  app/api/session-route.test.ts
  app/api/auth/sign-out-route.test.ts
  components/PlatformBadge.test.tsx
  components/ScoreRing.test.tsx
  components/HomeCard.test.tsx
  components/AppNav.test.tsx
  app/home/page.test.tsx
  app/page.test.tsx                    # NEW — covers the redirect
  app/recap/page.test.tsx               # MODIFIED — usePathname mock added
  app/ideas/page.test.tsx                # MODIFIED — usePathname mock added
  app/diagnostic/page.test.tsx            # MODIFIED — usePathname mock + 2 fetch-stub fixes

tests/e2e/
  home-smoke.spec.ts          # NEW
```

---

### Task 1: `lib/home/format.ts` — relative-date and compact-number helpers

**Files:**
- Create: `lib/home/format.ts`
- Test: `tests/unit/lib/home/format.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `formatRelativeDays(from: Date, now: Date): string`, `formatCompactNumber(n: number): string` — both relied on by `app/home/page.tsx` (Task 13)

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lib/home/format.test.ts
import { describe, it, expect } from 'vitest';
import { formatRelativeDays, formatCompactNumber } from '@/lib/home/format';

describe('formatRelativeDays', () => {
  const now = new Date('2026-08-16T12:00:00Z');

  it('returns "today" for the same calendar day', () => {
    expect(formatRelativeDays(new Date('2026-08-16T01:00:00Z'), now)).toBe('today');
  });

  it('returns "1 day ago" for yesterday', () => {
    expect(formatRelativeDays(new Date('2026-08-15T12:00:00Z'), now)).toBe('1 day ago');
  });

  it('returns "N days ago" under a week', () => {
    expect(formatRelativeDays(new Date('2026-08-13T12:00:00Z'), now)).toBe('3 days ago');
  });

  it('returns "1 week ago" for exactly 7 days', () => {
    expect(formatRelativeDays(new Date('2026-08-09T12:00:00Z'), now)).toBe('1 week ago');
  });

  it('returns "N weeks ago" for multiple weeks', () => {
    expect(formatRelativeDays(new Date('2026-07-26T12:00:00Z'), now)).toBe('3 weeks ago');
  });
});

describe('formatCompactNumber', () => {
  it('passes through numbers under 1000 unchanged', () => {
    expect(formatCompactNumber(999)).toBe('999');
    expect(formatCompactNumber(0)).toBe('0');
  });

  it('formats thousands with one decimal, trimming a trailing .0', () => {
    expect(formatCompactNumber(1500)).toBe('1.5K');
    expect(formatCompactNumber(142000)).toBe('142K');
    expect(formatCompactNumber(1000)).toBe('1K');
  });

  it('formats millions with one decimal, trimming a trailing .0', () => {
    expect(formatCompactNumber(1200000)).toBe('1.2M');
    expect(formatCompactNumber(2000000)).toBe('2M');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/home/format.test.ts`
Expected: FAIL with "Cannot find module '@/lib/home/format'"

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/home/format.ts

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole calendar days between `from` and `now`, floored — not a rolling 24h window. */
function daysBetween(from: Date, now: Date): number {
  const fromDay = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const nowDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((nowDay - fromDay) / DAY_MS);
}

export function formatRelativeDays(from: Date, now: Date): string {
  const days = Math.max(0, daysBetween(from, now));
  if (days === 0) return 'today';
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  const weeks = Math.round(days / 7);
  return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
}

function trimTrailingZero(value: string): string {
  return value.endsWith('.0') ? value.slice(0, -2) : value;
}

export function formatCompactNumber(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${trimTrailingZero((n / 1000).toFixed(1))}K`;
  return `${trimTrailingZero((n / 1_000_000).toFixed(1))}M`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/home/format.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/home/format.ts tests/unit/lib/home/format.test.ts
git commit -m "feat: add home page date/number formatting helpers"
```

---

### Task 2: `lib/home/display-name.ts` — derive a hero display name from an email

**Files:**
- Create: `lib/home/display-name.ts`
- Test: `tests/unit/lib/home/display-name.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `deriveDisplayNameFromEmail(email: string): string` — relied on by `app/home/page.tsx` (Task 13)

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lib/home/display-name.test.ts
import { describe, it, expect } from 'vitest';
import { deriveDisplayNameFromEmail } from '@/lib/home/display-name';

describe('deriveDisplayNameFromEmail', () => {
  it('capitalizes the first letter of the local part', () => {
    expect(deriveDisplayNameFromEmail('jordan@example.com')).toBe('Jordan');
  });

  it('leaves the rest of the local part unchanged', () => {
    expect(deriveDisplayNameFromEmail('jordan.reyes@example.com')).toBe('Jordan.reyes');
  });

  it('handles a single-character local part', () => {
    expect(deriveDisplayNameFromEmail('j@example.com')).toBe('J');
  });

  it('leaves an already-capitalized local part unchanged', () => {
    expect(deriveDisplayNameFromEmail('Jordan@example.com')).toBe('Jordan');
  });

  it('falls back to "there" for an email with no local part', () => {
    expect(deriveDisplayNameFromEmail('@example.com')).toBe('there');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/home/display-name.test.ts`
Expected: FAIL with "Cannot find module '@/lib/home/display-name'"

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/home/display-name.ts

export function deriveDisplayNameFromEmail(email: string): string {
  const localPart = email.split('@')[0] ?? '';
  if (!localPart) return 'there';
  return localPart.charAt(0).toUpperCase() + localPart.slice(1);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/home/display-name.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/home/display-name.ts tests/unit/lib/home/display-name.test.ts
git commit -m "feat: add hero display-name derivation helper"
```

---

### Task 3: `GET /api/session` route

**Files:**
- Create: `app/api/session/route.ts`
- Test: `tests/unit/app/api/session-route.test.ts`

**Interfaces:**
- Consumes: `createSupabaseServerClient` from `@/lib/supabase/server` (existing)
- Produces: `GET` handler returning `{ email: string }` (200) or `{ error: string }` (401) — relied on by `<AppNav>` (Task 9)

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/app/api/session-route.test.ts
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

const getUserMock = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(() => ({
    auth: { getUser: getUserMock },
  })),
}));

import { GET } from '@/app/api/session/route';

describe('GET /api/session', () => {
  it('returns the signed-in email', async () => {
    getUserMock.mockResolvedValue({ data: { user: { email: 'jordan@example.com' } } });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ email: 'jordan@example.com' });
  });

  it('returns 401 when signed out', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'You must be signed in.' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/app/api/session-route.test.ts`
Expected: FAIL with "Cannot find module '@/app/api/session/route'"

- [ ] **Step 3: Write minimal implementation**

```ts
// app/api/session/route.ts
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 });
  }

  return NextResponse.json({ email: user.email ?? '' });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/app/api/session-route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/session/route.ts tests/unit/app/api/session-route.test.ts
git commit -m "feat: add GET /api/session route for nav identity"
```

---

### Task 4: `POST /api/auth/sign-out` route

**Files:**
- Create: `app/api/auth/sign-out/route.ts`
- Test: `tests/unit/app/api/auth/sign-out-route.test.ts`

**Interfaces:**
- Consumes: `createSupabaseServerClient` from `@/lib/supabase/server` (existing)
- Produces: `POST` handler that signs out and returns `{ ok: true }` — called by `<AppNav>` (Task 9)

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/app/api/auth/sign-out-route.test.ts
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

const signOutMock = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(() => ({
    auth: { signOut: signOutMock },
  })),
}));

import { POST } from '@/app/api/auth/sign-out/route';

describe('POST /api/auth/sign-out', () => {
  it('signs out and returns ok', async () => {
    signOutMock.mockResolvedValue({ error: null });

    const response = await POST();
    const body = await response.json();

    expect(signOutMock).toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/app/api/auth/sign-out-route.test.ts`
Expected: FAIL with "Cannot find module '@/app/api/auth/sign-out/route'"

- [ ] **Step 3: Write minimal implementation**

```ts
// app/api/auth/sign-out/route.ts
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function POST() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/app/api/auth/sign-out-route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/auth/sign-out/route.ts tests/unit/app/api/auth/sign-out-route.test.ts
git commit -m "feat: add POST /api/auth/sign-out route"
```

---

### Task 5: `lib/home/types.ts` + `GET /api/home` route

**Files:**
- Create: `lib/home/types.ts`
- Create: `app/api/home/route.ts`

**Interfaces:**
- Consumes: `createSupabaseServerClient`/`createSupabaseServiceRoleClient` (existing), `weekStartKey` from `@/lib/ideas/handler` (existing), `PlatformTotals`/`RecapPlatform`/`RecapTopPost` from `@/lib/recap/types` (existing), `ContentIdea` from `@/lib/integrations/claude-ideas` (existing)
- Produces: `HomeData`, `HomeDiagnosticSummary`, `HomeRecapSummary`, `HomeIdeasSummary`, `HomeIdeasDigestSummary` types; a `GET` handler returning `HomeData` (200) or `{ error }` (401) — relied on by `app/home/page.tsx` (Task 13)

No dedicated unit test for this task — see Global Constraints. Verified via `npm run typecheck` and the Playwright test in Task 15.

- [ ] **Step 1: Write `lib/home/types.ts`**

```ts
// lib/home/types.ts
import type { PlatformTotals, RecapPlatform, RecapTopPost } from '@/lib/recap/types';

export type DiagnosticPlatform = 'youtube' | 'tiktok' | 'instagram';

export interface HomeDiagnosticSummary {
  id: string;
  platform: DiagnosticPlatform;
  overallScore: number;
  hookStrengthScore: number;
  retentionRiskScore: number;
  timingScore: number;
  formatFitScore: number;
  createdAt: string;
}

export interface HomeRecapSummary {
  id: string;
  month: string;
  totals: PlatformTotals;
  platformData: Partial<Record<RecapPlatform, PlatformTotals>>;
  topPost: RecapTopPost;
  generatedAt: string;
}

export interface HomeIdeasDigestSummary {
  weekStart: string;
  ideaCount: number;
  firstIdeaTitle: string;
}

export interface HomeIdeasSummary {
  niche: string | null;
  digest: HomeIdeasDigestSummary | null;
}

export interface HomeData {
  email: string;
  diagnostic: HomeDiagnosticSummary | null;
  recap: HomeRecapSummary | null;
  ideas: HomeIdeasSummary;
}
```

- [ ] **Step 2: Write `app/api/home/route.ts`**

```ts
// app/api/home/route.ts
import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { weekStartKey } from '@/lib/ideas/handler';
import type { PlatformTotals, RecapPlatform, RecapTopPost } from '@/lib/recap/types';
import type { ContentIdea } from '@/lib/integrations/claude-ideas';
import type { HomeData } from '@/lib/home/types';

function currentMonthKey(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'You must be signed in to view your dashboard.' }, { status: 401 });
  }

  const serviceClient = createSupabaseServiceRoleClient();
  const now = new Date();

  const [{ data: profile }, { data: diagnosticRow }, { data: recapRow }, { data: digestRow }] = await Promise.all([
    serviceClient.from('profiles').select('niche').eq('id', user.id).single(),
    serviceClient
      .from('diagnostics')
      .select(
        'id, platform, overall_score, hook_strength_score, retention_risk_score, timing_score, format_fit_score, created_at'
      )
      .eq('profile_id', user.id)
      .eq('status', 'complete')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    serviceClient
      .from('recap_cards')
      .select('id, month, totals, platform_data, top_post, generated_at')
      .eq('profile_id', user.id)
      .eq('month', currentMonthKey(now))
      .maybeSingle(),
    serviceClient
      .from('weekly_digests')
      .select('week_start, content_ideas')
      .eq('profile_id', user.id)
      .eq('week_start', weekStartKey(now))
      .maybeSingle(),
  ]);

  const contentIdeas = (digestRow?.content_ideas as ContentIdea[] | null) ?? null;

  const homeData: HomeData = {
    email: user.email ?? '',
    diagnostic: diagnosticRow
      ? {
          id: diagnosticRow.id,
          platform: diagnosticRow.platform,
          overallScore: diagnosticRow.overall_score ?? 0,
          hookStrengthScore: diagnosticRow.hook_strength_score ?? 0,
          retentionRiskScore: diagnosticRow.retention_risk_score ?? 0,
          timingScore: diagnosticRow.timing_score ?? 0,
          formatFitScore: diagnosticRow.format_fit_score ?? 0,
          createdAt: diagnosticRow.created_at,
        }
      : null,
    recap: recapRow
      ? {
          id: recapRow.id,
          month: recapRow.month,
          totals: recapRow.totals as PlatformTotals,
          platformData: recapRow.platform_data as Partial<Record<RecapPlatform, PlatformTotals>>,
          topPost: recapRow.top_post as RecapTopPost,
          generatedAt: recapRow.generated_at,
        }
      : null,
    ideas: {
      niche: profile?.niche ?? null,
      digest:
        contentIdeas && contentIdeas.length > 0
          ? {
              weekStart: digestRow!.week_start,
              ideaCount: contentIdeas.length,
              firstIdeaTitle: contentIdeas[0].workingTitle,
            }
          : null,
    },
  };

  return NextResponse.json(homeData);
}
```

- [ ] **Step 3: Verify it typechecks**

Run: `npm run typecheck`
Expected: no errors from `lib/home/types.ts` or `app/api/home/route.ts`

- [ ] **Step 4: Commit**

```bash
git add lib/home/types.ts app/api/home/route.ts
git commit -m "feat: add home data types and GET /api/home aggregation route"
```

---

### Task 6: `components/PlatformBadge.tsx`

**Files:**
- Create: `components/PlatformBadge.tsx`
- Test: `tests/unit/components/PlatformBadge.test.tsx`

**Interfaces:**
- Consumes: nothing
- Produces: `PlatformBadge`, `BadgePlatform` — relied on by `app/home/page.tsx` (Task 13)

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/components/PlatformBadge.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlatformBadge } from '@/components/PlatformBadge';

describe('PlatformBadge', () => {
  it('renders the YouTube badge with its brand color and accessible label', () => {
    render(<PlatformBadge platform="youtube" />);
    expect(screen.getByRole('img', { name: 'YouTube' }).className).toContain('bg-[#e5342a]');
  });

  it('renders the TikTok badge with its brand color and accessible label', () => {
    render(<PlatformBadge platform="tiktok" />);
    expect(screen.getByRole('img', { name: 'TikTok' }).className).toContain('bg-[#121212]');
  });

  it('renders the Instagram badge with a gradient background and accessible label', () => {
    render(<PlatformBadge platform="instagram" />);
    expect(screen.getByRole('img', { name: 'Instagram' }).className).toContain('linear-gradient');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/PlatformBadge.test.tsx`
Expected: FAIL with "Cannot find module '@/components/PlatformBadge'"

- [ ] **Step 3: Write minimal implementation**

```tsx
// components/PlatformBadge.tsx
export type BadgePlatform = 'youtube' | 'tiktok' | 'instagram';

const PLATFORM_CONFIG: Record<BadgePlatform, { label: string; className: string }> = {
  youtube: { label: 'YouTube', className: 'bg-[#e5342a]' },
  tiktok: { label: 'TikTok', className: 'bg-[#121212]' },
  instagram: {
    label: 'Instagram',
    className: 'bg-[linear-gradient(135deg,#f6a34d_0%,#dd2a7b_55%,#7b3fe4_100%)]',
  },
};

export interface PlatformBadgeProps {
  platform: BadgePlatform;
}

export function PlatformBadge({ platform }: PlatformBadgeProps) {
  const config = PLATFORM_CONFIG[platform];

  return (
    <span
      role="img"
      aria-label={config.label}
      className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-white ring-2 ring-white ${config.className}`}
    >
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4">
        {platform === 'youtube' && <path d="M9 7.5v9l7.5-4.5L9 7.5z" fill="currentColor" />}
        {platform === 'tiktok' && (
          <path
            d="M14 5c.4 2 1.8 3.4 3.8 3.6v2.5c-1.4 0-2.7-.4-3.8-1.2v5.4a4.7 4.7 0 1 1-4.7-4.7c.3 0 .6 0 .9.1v2.6a2.1 2.1 0 1 0 1.5 2V5H14z"
            fill="currentColor"
          />
        )}
        {platform === 'instagram' && (
          <rect x="4" y="4" width="16" height="16" rx="5" stroke="currentColor" strokeWidth="1.8" fill="none" />
        )}
      </svg>
    </span>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/PlatformBadge.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/PlatformBadge.tsx tests/unit/components/PlatformBadge.test.tsx
git commit -m "feat: add PlatformBadge component"
```

---

### Task 7: `components/ScoreRing.tsx`

**Files:**
- Create: `components/ScoreRing.tsx`
- Test: `tests/unit/components/ScoreRing.test.tsx`

**Interfaces:**
- Consumes: nothing
- Produces: `ScoreRing` — relied on by `app/home/page.tsx` (Task 13)

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/components/ScoreRing.test.tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ScoreRing } from '@/components/ScoreRing';

const CIRCUMFERENCE = 2 * Math.PI * 18;

describe('ScoreRing', () => {
  it('renders a full offset at 0', () => {
    const { getByTestId } = render(<ScoreRing value={0} label="Hook" color="#4338ca" />);
    expect(Number(getByTestId('score-ring-arc').getAttribute('stroke-dashoffset'))).toBeCloseTo(CIRCUMFERENCE, 5);
  });

  it('renders zero offset at 100', () => {
    const { getByTestId } = render(<ScoreRing value={100} label="Hook" color="#4338ca" />);
    expect(Number(getByTestId('score-ring-arc').getAttribute('stroke-dashoffset'))).toBeCloseTo(0, 5);
  });

  it('renders half offset at 50', () => {
    const { getByTestId } = render(<ScoreRing value={50} label="Hook" color="#4338ca" />);
    expect(Number(getByTestId('score-ring-arc').getAttribute('stroke-dashoffset'))).toBeCloseTo(CIRCUMFERENCE / 2, 5);
  });

  it('clamps out-of-range values into 0-100', () => {
    const { getByTestId } = render(<ScoreRing value={150} label="Hook" color="#4338ca" />);
    expect(Number(getByTestId('score-ring-arc').getAttribute('stroke-dashoffset'))).toBeCloseTo(0, 5);
  });

  it('renders the rounded score and label as visible text', () => {
    const { getByText } = render(<ScoreRing value={82.4} label="Hook" color="#4338ca" />);
    expect(getByText('82')).toBeInTheDocument();
    expect(getByText('Hook')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/ScoreRing.test.tsx`
Expected: FAIL with "Cannot find module '@/components/ScoreRing'"

- [ ] **Step 3: Write minimal implementation**

```tsx
// components/ScoreRing.tsx
const RADIUS = 18;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export interface ScoreRingProps {
  value: number;
  label: string;
  color: string;
}

export function ScoreRing({ value, label, color }: ScoreRingProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const offset = CIRCUMFERENCE * (1 - clamped / 100);

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="48" height="48" viewBox="0 0 44 44" aria-hidden="true">
        <circle cx="22" cy="22" r={RADIUS} fill="none" stroke="#ece8f8" strokeWidth="4" />
        <circle
          data-testid="score-ring-arc"
          cx="22"
          cy="22"
          r={RADIUS}
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          transform="rotate(-90 22 22)"
        />
        <text x="22" y="26" textAnchor="middle" className="fill-gray-900 text-[9px] font-bold">
          {Math.round(clamped)}
        </text>
      </svg>
      <span className="text-[11px] text-gray-400">{label}</span>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/ScoreRing.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/ScoreRing.tsx tests/unit/components/ScoreRing.test.tsx
git commit -m "feat: add ScoreRing component"
```

---

### Task 8: `components/HomeCard.tsx`

**Files:**
- Create: `components/HomeCard.tsx`
- Test: `tests/unit/components/HomeCard.test.tsx`

**Interfaces:**
- Consumes: nothing
- Produces: `HomeCard` — relied on by `app/home/page.tsx` (Task 13)

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/components/HomeCard.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HomeCard } from '@/components/HomeCard';

describe('HomeCard', () => {
  it('renders its children', () => {
    render(
      <HomeCard>
        <p>Card content</p>
      </HomeCard>
    );
    expect(screen.getByText('Card content')).toBeInTheDocument();
  });

  it('applies the default white-card styling by default', () => {
    const { container } = render(<HomeCard>content</HomeCard>);
    expect(container.firstChild).toHaveClass('bg-white');
  });

  it('applies the gradient cta styling when variant is "cta"', () => {
    const { container } = render(<HomeCard variant="cta">content</HomeCard>);
    expect(container.firstChild?.className).toContain('linear-gradient');
    expect(container.firstChild).not.toHaveClass('bg-white');
  });

  it('sets aria-labelledby when provided', () => {
    render(
      <HomeCard ariaLabelledBy="my-heading">
        <h3 id="my-heading">Heading</h3>
      </HomeCard>
    );
    expect(screen.getByRole('article')).toHaveAttribute('aria-labelledby', 'my-heading');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/HomeCard.test.tsx`
Expected: FAIL with "Cannot find module '@/components/HomeCard'"

- [ ] **Step 3: Write minimal implementation**

```tsx
// components/HomeCard.tsx
export interface HomeCardProps {
  variant?: 'default' | 'cta';
  ariaLabelledBy?: string;
  children: React.ReactNode;
}

export function HomeCard({ variant = 'default', ariaLabelledBy, children }: HomeCardProps) {
  const base = 'flex min-h-[15.5rem] flex-col gap-4 rounded-2xl p-6';
  const defaultStyle = 'border border-gray-200 bg-white';
  const ctaStyle =
    'bg-[linear-gradient(150deg,#5b3ee0_0%,#7c3aed_55%,#a855f7_100%)] text-white shadow-[0_20px_40px_-18px_rgba(67,56,202,0.3)]';

  return (
    <article aria-labelledby={ariaLabelledBy} className={`${base} ${variant === 'cta' ? ctaStyle : defaultStyle}`}>
      {children}
    </article>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/HomeCard.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/HomeCard.tsx tests/unit/components/HomeCard.test.tsx
git commit -m "feat: add HomeCard shared card shell component"
```

---

### Task 9: `components/AppNav.tsx`

**Files:**
- Create: `components/AppNav.tsx`
- Test: `tests/unit/components/AppNav.test.tsx`

**Interfaces:**
- Consumes: `usePathname`/`useRouter` from `next/navigation` (existing), `GET /api/session` (Task 3), `POST /api/auth/sign-out` (Task 4)
- Produces: `AppNav` (no required props) — mounted on `/home` (Task 13), `/recap` (Task 10), `/ideas` (Task 11), `/diagnostic` (Task 12)

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/components/AppNav.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: () => '/home',
  useRouter: () => ({ push: pushMock }),
}));

import { AppNav } from '@/components/AppNav';

describe('AppNav', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    pushMock.mockClear();
  });

  it('renders nothing while the session check is pending', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const { container } = render(<AppNav />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the session check returns 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }));
    const { container } = render(<AppNav />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('shows identity and highlights the active link once signed in', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ email: 'jordan@example.com' }) }));
    render(<AppNav />);
    await waitFor(() => expect(screen.getByText('jordan@example.com')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Diagnostic' })).not.toHaveAttribute('aria-current');
  });

  it('calls sign-out then navigates home when Sign out is clicked', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/session') return Promise.resolve({ ok: true, json: async () => ({ email: 'jordan@example.com' }) });
      return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AppNav />);
    await waitFor(() => expect(screen.getByText('jordan@example.com')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/auth/sign-out', { method: 'POST' }));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/AppNav.test.tsx`
Expected: FAIL with "Cannot find module '@/components/AppNav'"

- [ ] **Step 3: Write minimal implementation**

```tsx
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
    await fetch('/api/auth/sign-out', { method: 'POST' }).catch(() => null);
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
        <div className="hidden flex-col text-right leading-tight sm:flex">
          <span className="text-sm font-semibold text-gray-900">{email}</span>
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/AppNav.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/AppNav.tsx tests/unit/components/AppNav.test.tsx
git commit -m "feat: add AppNav shared navigation component"
```

---

### Task 10: Mount `<AppNav />` on `/recap`

**Files:**
- Modify: `app/recap/page.tsx`
- Modify: `tests/unit/app/recap/page.test.tsx`

**Interfaces:**
- Consumes: `AppNav` (Task 9)
- Produces: nothing new consumed elsewhere

`<AppNav>` self-fetches its own identity (Task 9's design), so mounting it here adds no new props or bootstrap fields to `/recap` — only a mount point and, for its tests, a `usePathname` addition to the existing `next/navigation` mock (`AppNav` calls `usePathname()` unconditionally for active-link highlighting, and the current mock only provides `useRouter`/`useSearchParams`).

- [ ] **Step 1: Mount `<AppNav />` at the top of the authenticated render**

In `app/recap/page.tsx`, add the import and mount it as the first child of the final `<main>` return (the one reached only after the `loading`/`redirectingToCard` and sign-in-flow early returns):

```tsx
// app/recap/page.tsx — add near the top with the other imports
import { AppNav } from '@/components/AppNav';
```

```tsx
// app/recap/page.tsx — the final return, currently:
//   return (
//     <main className="mx-auto flex max-w-md flex-col gap-6 px-6 py-16">
//       <h1 className="text-2xl font-bold text-gray-900">Monthly recap card</h1>
// becomes:
  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-6 py-16">
      <AppNav />
      <h1 className="text-2xl font-bold text-gray-900">Monthly recap card</h1>
```

- [ ] **Step 2: Update the test file's `next/navigation` mock**

In `tests/unit/app/recap/page.test.tsx`, change:

```tsx
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => searchParams,
}));
```

to:

```tsx
vi.mock('next/navigation', () => ({
  usePathname: () => '/recap',
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => searchParams,
}));
```

- [ ] **Step 3: Run the full test file to verify it still passes**

Run: `npx vitest run tests/unit/app/recap/page.test.tsx`
Expected: PASS — since `<AppNav>` self-fetches independently of this page's own `fetch` mocks and always renders `null` until its own `/api/session` call resolves (which none of these tests await or assert on), no existing assertion in this file is affected by the mount. If any test unexpectedly fails, it will be because that test asserts on `screen.getAllByRole`/exact DOM structure that AppNav's (initially-null) render doesn't affect — re-read the failure output before changing anything else.

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add app/recap/page.tsx tests/unit/app/recap/page.test.tsx
git commit -m "feat: mount AppNav on /recap"
```

---

### Task 11: Mount `<AppNav />` on `/ideas`

**Files:**
- Modify: `app/ideas/page.tsx`
- Modify: `tests/unit/app/ideas/page.test.tsx`

**Interfaces:**
- Consumes: `AppNav` (Task 9)
- Produces: nothing new consumed elsewhere

- [ ] **Step 1: Mount `<AppNav />` at the top of the authenticated render**

```tsx
// app/ideas/page.tsx — add near the top with the other imports
import { AppNav } from '@/components/AppNav';
```

```tsx
// app/ideas/page.tsx — the final return, currently:
//   return (
//     <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
//       <h1 className="text-2xl font-bold text-gray-900">Weekly content ideas</h1>
// becomes:
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
      <AppNav />
      <h1 className="text-2xl font-bold text-gray-900">Weekly content ideas</h1>
```

- [ ] **Step 2: Update the test file's `next/navigation` mock**

In `tests/unit/app/ideas/page.test.tsx`, change:

```tsx
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
```

to:

```tsx
vi.mock('next/navigation', () => ({
  usePathname: () => '/ideas',
  useRouter: () => ({ push: vi.fn() }),
}));
```

- [ ] **Step 3: Run the full test file to verify it still passes**

Run: `npx vitest run tests/unit/app/ideas/page.test.tsx`
Expected: PASS, for the same reason as Task 10 — `<AppNav>` fetches independently and renders `null` until resolved, so none of this file's existing `fetch`/DOM assertions are affected.

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add app/ideas/page.tsx tests/unit/app/ideas/page.test.tsx
git commit -m "feat: mount AppNav on /ideas"
```

---

### Task 12: Mount `<AppNav />` on `/diagnostic`

**Files:**
- Modify: `app/diagnostic/page.tsx`
- Modify: `tests/unit/app/diagnostic/page.test.tsx`

**Interfaces:**
- Consumes: `AppNav` (Task 9)
- Produces: nothing new consumed elsewhere

`/diagnostic` is the one page where `<AppNav>` mounts **unconditionally** (not gated behind an authenticated-only branch), since this page deliberately lets an anonymous visitor start typing a URL before any sign-in check happens (`lib/auth/sign-in-flow-state.ts`). `<AppNav>` renders nothing until its own `/api/session` check resolves, so this doesn't add friction — it just means, unlike Tasks 10/11, this page's tests **do** need fixing, because `<AppNav>` now fires a `fetch('/api/session')` call on every render of this page, including two tests that specifically assert on `fetch` call behavior.

- [ ] **Step 1: Mount `<AppNav />` unconditionally at the top of the page**

```tsx
// app/diagnostic/page.tsx — add near the top with the other imports
import { AppNav } from '@/components/AppNav';
```

```tsx
// app/diagnostic/page.tsx — DiagnosticInputPageInner's return, currently:
//   return (
//     <main className="mx-auto flex max-w-xl flex-col gap-6 px-6 py-16">
//       <h1 className="text-2xl font-bold text-gray-900">Run a diagnostic</h1>
// becomes:
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-6 py-16">
      <AppNav />
      <h1 className="text-2xl font-bold text-gray-900">Run a diagnostic</h1>
```

- [ ] **Step 2: Update the test file's `next/navigation` mock**

In `tests/unit/app/diagnostic/page.test.tsx`, change:

```tsx
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => mockSearchParams,
}));
```

to:

```tsx
vi.mock('next/navigation', () => ({
  usePathname: () => '/diagnostic',
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => mockSearchParams,
}));
```

- [ ] **Step 3: Fix the test that asserts no fetch call happens on plain mount**

This test currently asserts `fetch` is never called on a plain prefill-without-submit — that's no longer true, since `<AppNav>` now always calls `fetch('/api/session')` on mount. Change it to assert the page itself never makes its own diagnostic-related call, which is the test's actual intent:

```tsx
// tests/unit/app/diagnostic/page.test.tsx — replace this test:
  it('pre-fills the url from ?url= on mount without auto-submitting', () => {
    mockSearchParams = new URLSearchParams('url=' + encodeURIComponent('https://www.tiktok.com/@user/video/123'));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<DiagnosticInputPage />);

    expect(screen.getByLabelText(/paste a youtube, tiktok, or instagram link/i)).toHaveValue('https://www.tiktok.com/@user/video/123');
    expect(fetchMock).not.toHaveBeenCalled();
  });

// with:
  it('pre-fills the url from ?url= on mount without auto-submitting', () => {
    mockSearchParams = new URLSearchParams('url=' + encodeURIComponent('https://www.tiktok.com/@user/video/123'));
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    render(<DiagnosticInputPage />);

    expect(screen.getByLabelText(/paste a youtube, tiktok, or instagram link/i)).toHaveValue('https://www.tiktok.com/@user/video/123');
    // AppNav's own /api/session check is expected; the page itself must not
    // have made a diagnostic-related call on plain mount.
    expect(fetchMock).not.toHaveBeenCalledWith('/api/diagnostic', expect.anything());
  });
```

- [ ] **Step 4: Fix the test with no fetch stub at all**

This test currently renders the page with no `fetch` stub, which is now unsafe since `<AppNav>` calls `fetch` unconditionally on mount:

```tsx
// tests/unit/app/diagnostic/page.test.tsx — replace this test:
  it('lands directly in the sign-in prompt with a notice when returning from an expired magic link', () => {
    mockSearchParams = new URLSearchParams(
      'url=' + encodeURIComponent('https://www.tiktok.com/@user/video/123') + '&authError=expired'
    );
    render(<DiagnosticInputPage />);

    expect(screen.getByText(/didn't work.*expired/i)).toBeInTheDocument();
    expect(screen.getByText(/checking:/i)).toHaveTextContent('https://www.tiktok.com/@user/video/123');
  });

// with:
  it('lands directly in the sign-in prompt with a notice when returning from an expired magic link', () => {
    mockSearchParams = new URLSearchParams(
      'url=' + encodeURIComponent('https://www.tiktok.com/@user/video/123') + '&authError=expired'
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }));
    render(<DiagnosticInputPage />);

    expect(screen.getByText(/didn't work.*expired/i)).toBeInTheDocument();
    expect(screen.getByText(/checking:/i)).toHaveTextContent('https://www.tiktok.com/@user/video/123');
  });
```

- [ ] **Step 5: Run the full test file to verify it passes**

Run: `npx vitest run tests/unit/app/diagnostic/page.test.tsx`
Expected: PASS — all other tests in this file already stub `fetch` with either a persistent `mockResolvedValue` or a queued chain where `<AppNav>`'s extra call lands after the assertions under test have already resolved; none of them assert `fetch` call counts or exact call sequences the way the two fixed tests did.

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add app/diagnostic/page.tsx tests/unit/app/diagnostic/page.test.tsx
git commit -m "feat: mount AppNav on /diagnostic"
```

---

### Task 13: `app/home/page.tsx`

**Files:**
- Create: `app/home/page.tsx`
- Test: `tests/unit/app/home/page.test.tsx`

**Interfaces:**
- Consumes: `AppNav` (Task 9), `PlatformBadge`/`BadgePlatform` (Task 6), `ScoreRing` (Task 7), `HomeCard` (Task 8), `formatRelativeDays`/`formatCompactNumber` (Task 1), `deriveDisplayNameFromEmail` (Task 2), `HomeData` (Task 5), `GET /api/home` (Task 5)
- Produces: `HomePage` default export — the page itself; nothing else consumes it

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/app/home/page.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: () => '/home',
  useRouter: () => ({ push: pushMock }),
}));

import HomePage from '@/app/home/page';

function homeResponse(overrides: Record<string, unknown> = {}) {
  return {
    email: 'jordan@example.com',
    diagnostic: null,
    recap: null,
    ideas: { niche: null, digest: null },
    ...overrides,
  };
}

describe('HomePage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    pushMock.mockClear();
  });

  it('shows a prompt-to-act card for every section with no data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => homeResponse() }));
    render(<HomePage />);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Run your first diagnostic' })).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: "Generate this month's recap" })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Set your niche to get this week&apos;s ideas'.replace('&apos;', "'") })).toBeInTheDocument();
  });

  it('shows the latest diagnostic score when one exists', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () =>
          homeResponse({
            diagnostic: {
              id: 'diagnostic-1',
              platform: 'youtube',
              overallScore: 78,
              hookStrengthScore: 82,
              retentionRiskScore: 61,
              timingScore: 88,
              formatFitScore: 75,
              createdAt: '2026-08-13T00:00:00Z',
            },
          }),
      })
    );
    render(<HomePage />);
    await waitFor(() => expect(screen.getByText('78')).toBeInTheDocument());
    expect(screen.getByText('/100')).toBeInTheDocument();
  });

  it('shows the recap stat and top post when a card exists for this month', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () =>
          homeResponse({
            recap: {
              id: 'card-1',
              month: '2026-08-01',
              totals: { views: 142000, likes: 4000, comments: 300, postCount: 5 },
              platformData: { youtube: { views: 100000, likes: 3000, comments: 200, postCount: 3 } },
              topPost: { platform: 'youtube', captionOrTitle: '3 Editing Tricks I Wish I Knew Sooner', viewCount: 38000, permalink: 'https://example.com' },
              generatedAt: '2026-08-01T00:00:00Z',
            },
          }),
      })
    );
    render(<HomePage />);
    await waitFor(() => expect(screen.getByText('142K')).toBeInTheDocument());
    expect(screen.getByText(/3 Editing Tricks I Wish I Knew Sooner/)).toBeInTheDocument();
  });

  it('shows a "set your niche" prompt when no niche is set', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => homeResponse() }));
    render(<HomePage />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Set my niche' })).toBeInTheDocument()
    );
  });

  it('shows a "get this week\'s ideas" prompt when a niche is set but nothing is generated yet', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => homeResponse({ ideas: { niche: 'home baking', digest: null } }) })
    );
    render(<HomePage />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Get my ideas' })).toBeInTheDocument());
  });

  it('shows the idea teaser when this week already has a digest', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () =>
          homeResponse({
            ideas: { niche: 'home baking', digest: { weekStart: '2026-08-10', ideaCount: 3, firstIdeaTitle: 'Sourdough Speedrun' } },
          }),
      })
    );
    render(<HomePage />);
    await waitFor(() => expect(screen.getByText('Sourdough Speedrun')).toBeInTheDocument());
    expect(screen.getByText('+2 more')).toBeInTheDocument();
  });

  it('shows the hero welcome message derived from the email', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => homeResponse({ email: 'jordan@example.com' }) }));
    render(<HomePage />);
    await waitFor(() => expect(screen.getByText('Welcome back, Jordan.')).toBeInTheDocument());
  });

  it('redirects to / when the bootstrap fetch is unauthorized', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'unauthorized' }) }));
    render(<HomePage />);
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/app/home/page.test.tsx`
Expected: FAIL with "Cannot find module '@/app/home/page'"

- [ ] **Step 3: Write minimal implementation**

```tsx
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/app/home/page.test.tsx`
Expected: PASS

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add app/home/page.tsx tests/unit/app/home/page.test.tsx
git commit -m "feat: add the dashboard home page"
```

---

### Task 14: `/` redirects a signed-in visitor to `/home`

**Files:**
- Modify: `app/page.tsx`
- Test: `tests/unit/app/page.test.tsx` (new)

**Interfaces:**
- Consumes: `createSupabaseServerClient` from `@/lib/supabase/server` (existing), `redirect` from `next/navigation` (new usage in this repo)
- Produces: nothing consumed elsewhere — terminal task for the redirect behavior

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/app/page.test.tsx
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

const getUserMock = vi.fn();
const redirectMock = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(() => ({
    auth: { getUser: getUserMock },
  })),
}));

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}));

import HomePage from '@/app/page';

describe('/ (marketing landing page)', () => {
  it('redirects to /home when the visitor is signed in', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'profile-1' } } });
    redirectMock.mockImplementation(() => {
      throw new Error('NEXT_REDIRECT');
    });

    await expect(HomePage()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirectMock).toHaveBeenCalledWith('/home');
  });

  it('renders the marketing content when signed out', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });

    const element = await HomePage();

    expect(redirectMock).not.toHaveBeenCalled();
    expect(element).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/app/page.test.tsx`
Expected: FAIL — the current `app/page.tsx` default export is a synchronous, non-async component that never calls `getUser`/`redirect`, so `HomePage()` doesn't return a promise and `redirectMock` is never called.

- [ ] **Step 3: Write minimal implementation**

```tsx
// app/page.tsx
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export default async function HomePage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect('/home');
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
    </main>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/app/page.test.tsx`
Expected: PASS

- [ ] **Step 5: Run typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: both succeed — `app/page.tsx` compiles as a valid async Server Component (no `'use client'` directive was ever added to it, so this conversion is safe)

- [ ] **Step 6: Commit**

```bash
git add app/page.tsx tests/unit/app/page.test.tsx
git commit -m "feat: redirect signed-in visitors from / to /home"
```

---

### Task 15: Playwright E2E smoke test

**Files:**
- Create: `tests/e2e/home-smoke.spec.ts`

**Interfaces:**
- Consumes: `/home` (Task 13), `GET /api/home` (Task 5), `GET /api/session` (Task 3) — all mocked at the browser network layer
- Produces: nothing consumed by later tasks — terminal verification for the whole feature

- [ ] **Step 1: Write the E2E test**

```ts
// tests/e2e/home-smoke.spec.ts
import { test, expect } from '@playwright/test';

test('dashboard home renders all three sections and nav links work', async ({ page }) => {
  await page.route('**/api/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ email: 'jordan@example.com' }),
    });
  });

  await page.route('**/api/home', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        email: 'jordan@example.com',
        diagnostic: {
          id: 'diagnostic-1',
          platform: 'youtube',
          overallScore: 78,
          hookStrengthScore: 82,
          retentionRiskScore: 61,
          timingScore: 88,
          formatFitScore: 75,
          createdAt: '2026-08-13T00:00:00Z',
        },
        recap: {
          id: 'card-1',
          month: '2026-08-01',
          totals: { views: 142000, likes: 4000, comments: 300, postCount: 5 },
          platformData: {
            youtube: { views: 104000, likes: 3000, comments: 200, postCount: 3 },
            tiktok: { views: 38000, likes: 1000, comments: 100, postCount: 2 },
          },
          topPost: {
            platform: 'youtube',
            captionOrTitle: '3 Editing Tricks I Wish I Knew Sooner',
            viewCount: 38000,
            permalink: 'https://example.com/post',
          },
          generatedAt: '2026-08-01T00:00:00Z',
        },
        ideas: { niche: 'home baking', digest: null },
      }),
    });
  });

  await page.goto('/home');

  await expect(page.getByText('Welcome back, Jordan.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Latest diagnostic' })).toBeVisible();
  await expect(page.getByText('142K')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Get my ideas' })).toBeVisible();

  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
  await page.getByRole('link', { name: 'Diagnostic' }).click();
  await expect(page).toHaveURL(/\/diagnostic$/);
});
```

- [ ] **Step 2: Run the test**

Run: `npm run build && npx playwright install --with-deps chromium && npm run test:e2e`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/home-smoke.spec.ts
git commit -m "test: add Playwright smoke test for the dashboard home page"
```

---

## Self-Review Notes

**Spec coverage:** §1 (no schema changes) — confirmed, no migration in this plan. §2 (`GET /api/home`) — Task 5. §3 (`GET /api/session`) — Task 3. §4 (sign-out) — Task 4. §5 (`<AppNav>`) — Task 9, mounted in Tasks 10-13. §6 (`/home` page + loading/redirect states) — Task 13. §7.1-7.3 (all three cards, all states including Ideas' three-way branch) — Task 13. §7.4 (shared helpers) — Tasks 1-2. §8 (visual tokens) — folded into Task 13's Tailwind classes (arbitrary-value gradients/shadows match the spec's named values exactly: `#4338ca`→`#9333ea` hero gradient, `#e5342a`/`#121212`/Instagram gradient badges, `rounded-[28px]` shell). §9 (`/` redirect) — Task 14. §10 (testing) — every listed test file has a task; the spec's `PlatformBadge.test.tsx`/`ScoreRing.test.tsx`/`AppNav.test.tsx`/`app/home/page.test.tsx`/`home-smoke.spec.ts` all appear as Tasks 6, 7, 9, 13, 15 respectively.

**Deviation from spec, logged:** the spec's §3 note that `<AppNav>` "always" self-fetches is implemented literally (no `email` prop was introduced) — confirmed consistent after closer analysis of the existing `/recap` and `/ideas` test suites: those suites use long `.mockResolvedValueOnce(...)` chains, and a prop-based design would have required rewriting ~50 `toEqual` assertions across `lib/recap/page-state.test.ts`/`lib/ideas/page-state.test.ts` to add a new state field, which is a larger and less certain change than the self-fetch design's actual cost (two small, precisely-identified test fixes in `app/diagnostic/page.test.tsx`, Task 12). This was evaluated in depth during planning and the spec's original design held up as the better call.

**Placeholder scan:** every step has complete, runnable code; no "TBD"/"similar to Task N"/hand-wavy error-handling steps. Task 5 and Tasks 10-11 explicitly document *why* they have no dedicated unit test (matching this repo's own established precedent for GET-only aggregation routes and for a self-fetching child component that doesn't affect a parent's existing assertions) rather than silently omitting one.

**Type consistency verified across tasks:** `HomeData`/`HomeDiagnosticSummary`/`HomeRecapSummary`/`HomeIdeasSummary`/`HomeIdeasDigestSummary` (Task 5) are the exact shape consumed by `app/home/page.tsx` (Task 13) and asserted against in its test's `homeResponse()` fixture. `BadgePlatform` (Task 6) is a strict subset of `DiagnosticPlatform`/`RecapPlatform` and is cast at the two call sites in Task 13 (`diagnostic.platform as BadgePlatform`, `p as BadgePlatform`) rather than silently assuming compatibility. `ScoreRing`'s `value`/`label`/`color` props (Task 7) match exactly how Task 13 constructs its four-ring array. `AppNav` (Task 9) has zero required props everywhere it's mounted (Tasks 10-13), so no task downstream of Task 9 needed to change its call signature.

---

## Verification (end-to-end, once all 15 tasks are complete)

1. `npm run typecheck && npm run lint` — clean.
2. `npm test` — full Vitest suite green, including the modified `app/recap/page.test.tsx`/`app/ideas/page.test.tsx`/`app/diagnostic/page.test.tsx`.
3. `npm run build` — production build succeeds.
4. `npx playwright install --with-deps chromium && npm run test:e2e` — full E2E suite passes, including the new `home-smoke.spec.ts` and the existing `diagnostic-smoke.spec.ts`/`recap-smoke.spec.ts`/`ideas-smoke.spec.ts`/`oauth-connect-smoke.spec.ts` (none of which should have regressed from the `<AppNav>` mounts).
5. Manually click through `/home` → `/diagnostic` → `/recap` → `/ideas` → `/home` via the nav links in a real browser session (or via Playwright's UI mode) to confirm active-link highlighting and sign-out actually work end-to-end against a real (or locally-run) Supabase project — this plan's automated tests all run against mocked network calls, so this is the one manual check nothing else in this plan covers.
