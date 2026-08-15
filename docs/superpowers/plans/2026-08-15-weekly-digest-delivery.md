# Weekly Digest Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first scheduled job and first outbound transactional email in this app — a creator opts in on `/ideas`, and every Monday morning a cron job generates (reusing the existing on-demand pipeline where needed) and emails that week's content-ideas digest, with a one-click unsubscribe.

**Architecture:** Two small new modules (`lib/digest/`) plus two new integrations (`lib/integrations/resend.ts`, `lib/email/`) wired together by one new route (`app/api/cron/weekly-digest/route.ts`) triggered by Vercel Cron. Everything follows this repo's established DI pattern — pure, dependency-injected logic in `lib/`, thin `route.ts` wrappers that supply real Supabase/Resend/Claude clients — the same shape as `lib/ideas/handler.ts` / `app/api/ideas/route.ts`. The cron job's per-candidate pipeline reuses `ContentIdeasClient` and `weekStartKey` from the already-shipped Weekly Content Ideas feature rather than duplicating them.

**Tech Stack:** Next.js 16 (App Router) + TypeScript, Vercel Cron (`vercel.json`), Resend REST API via plain `fetch` (no SDK — matches every other integration in this codebase), Supabase (existing), Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-15-weekly-digest-delivery-design.md` (committed at `3d7f72b`) — this plan implements every section of that spec.

## Global Constraints

- Opt-in is explicit and off by default — no profile is ever enrolled in email just by setting a niche (spec §1 decision 1).
- The cron job generates on behalf of opted-in profiles proactively — it is not a delivery-only mirror of on-demand usage (decision 2).
- Resend is called via plain `fetch` against its REST API — no SDK dependency added to `package.json` (decision 3).
- Single serial-loop cron job (no queue, no new infrastructure) — this is a deliberate v1 choice, not an oversight (decision 4).
- Unsubscribe is one-click and requires no login, via a stateless signed (HMAC) token — nothing is stored to make it work (decision 5).
- A hard cap of `WEEKLY_DIGEST_RUN_CAP = 200` profiles is processed per run, fairness-ordered by longest-since-last-sent (decision 6).
- The cron pipeline does **not** use `checkAndRecordRateLimit`/`RateLimitStore` — that machinery throttles per-IP/per-profile HTTP requests, which doesn't apply to a system-triggered batch job (spec §3).
- Follow the existing DI pattern throughout: pure, dependency-injected core logic in `lib/`, thin `route.ts` wrappers that wire real Supabase/integration clients (repo-wide convention, e.g. `lib/ideas/handler.ts` / `app/api/ideas/route.ts`).
- Reuse `weekStartKey` from `@/lib/ideas/handler` (already exported) rather than reimplementing Monday-of-week math.

---

## File Structure

```
supabase/migrations/
  20260815010000_add_weekly_digest_email_fields.sql   # profiles.digest_email_opt_in, profiles.digest_last_sent_at

lib/supabase/
  types.ts                              # MODIFIED — new profiles columns

lib/digest/
  unsubscribe-token.ts                  # generateUnsubscribeToken, verifyUnsubscribeToken
  opt-in.ts                             # saveDigestOptIn(deps, params)
  unsubscribe.ts                        # handleUnsubscribe(deps, params)
  cron-handler.ts                       # runWeeklyDigestCron(deps, now), buildUnsubscribeUrl, WEEKLY_DIGEST_RUN_CAP

lib/integrations/
  resend.ts                             # EmailClient, createResendEmailClient

lib/email/
  weekly-digest-template.ts             # renderWeeklyDigestEmail

lib/ideas/
  page-state.ts                         # MODIFIED — digestEmailOptIn threaded through, two new events

app/api/digest/
  opt-in/route.ts                       # POST — save the toggle
  unsubscribe/route.ts                  # GET — verify token, opt out, redirect

app/api/cron/
  weekly-digest/route.ts                # GET — the scheduled job itself

app/api/ideas/
  route.ts                              # MODIFIED — GET now also returns digestEmailOptIn

app/digest/unsubscribed/
  page.tsx                              # public confirmation page

app/ideas/
  page.tsx                              # MODIFIED — opt-in toggle UI

vercel.json                             # new — cron schedule
.env.example                            # MODIFIED — RESEND_API_KEY, DIGEST_FROM_EMAIL, DIGEST_UNSUBSCRIBE_SECRET, CRON_SECRET
README.md                               # MODIFIED — setup notes for the above

tests/unit/lib/digest/
  unsubscribe-token.test.ts
  opt-in.test.ts
  unsubscribe.test.ts
  cron-handler.test.ts

tests/unit/lib/integrations/resend.test.ts
tests/unit/lib/email/weekly-digest-template.test.ts
tests/unit/lib/ideas/page-state.test.ts             # MODIFIED — full rewrite (shape change)
tests/unit/app/ideas/page.test.tsx                    # MODIFIED — new test cases appended
tests/unit/app/digest/unsubscribed/page.test.tsx
tests/unit/supabase/migrations.test.ts                # MODIFIED — new test case appended

tests/e2e/ideas-smoke.spec.ts                          # MODIFIED — new test case appended
```

---

### Task 1: SQL migration — profiles email fields + Database types

**Files:**
- Create: `supabase/migrations/20260815010000_add_weekly_digest_email_fields.sql`
- Modify: `lib/supabase/types.ts`
- Modify: `tests/unit/supabase/migrations.test.ts`

**Interfaces:**
- Consumes: nothing (first task in this feature)
- Produces: `Database['public']['Tables']['profiles']['Row']` gains `digest_email_opt_in: boolean` and `digest_last_sent_at: string | null` — relied on by every later task that reads/writes a profile

- [ ] **Step 1: Write the failing test**

Add this test case to the end of the `describe('supabase migrations', ...)` block in `tests/unit/supabase/migrations.test.ts` (just before the final closing `});`):

```ts
  it('includes a migration adding weekly digest opt-in and last-sent tracking to profiles', () => {
    const sql = readMigrationContaining('add_weekly_digest_email_fields');
    expect(sql).toContain('add column digest_email_opt_in boolean not null default false');
    expect(sql).toContain('add column digest_last_sent_at timestamptz');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/supabase/migrations.test.ts`
Expected: FAIL with `No migration file matching "add_weekly_digest_email_fields"`

- [ ] **Step 3: Write minimal implementation**

```sql
-- supabase/migrations/20260815010000_add_weekly_digest_email_fields.sql
-- Weekly Digest Delivery: a creator opts in to a proactive Monday email of
-- their content ideas, off by default. digest_last_sent_at exists purely to
-- keep the cron job's per-run cap fair across weeks — see
-- docs/superpowers/specs/2026-08-15-weekly-digest-delivery-design.md §1/§3.
alter table public.profiles
  add column digest_email_opt_in boolean not null default false,
  add column digest_last_sent_at timestamptz;
```

Update `lib/supabase/types.ts`'s `profiles` table entry (both `Row` and `Insert`) — replace the existing `profiles` block with:

```ts
      profiles: {
        Row: {
          id: string;
          email: string;
          display_name: string | null;
          niche: string | null;
          youtube_channel_handle: string | null;
          tiktok_handle: string | null;
          instagram_handle: string | null;
          digest_email_opt_in: boolean;
          digest_last_sent_at: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          email: string;
          display_name?: string | null;
          niche?: string | null;
          youtube_channel_handle?: string | null;
          tiktok_handle?: string | null;
          instagram_handle?: string | null;
          digest_email_opt_in?: boolean;
          digest_last_sent_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>;
        Relationships: [];
      };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/supabase/migrations.test.ts`
Expected: PASS

Also run `npm run typecheck` to confirm the `types.ts` change compiles cleanly.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260815010000_add_weekly_digest_email_fields.sql lib/supabase/types.ts tests/unit/supabase/migrations.test.ts
git commit -m "feat: add weekly digest opt-in + last-sent columns to profiles"
```

---

### Task 2: Unsubscribe token — `lib/digest/unsubscribe-token.ts`

**Files:**
- Create: `lib/digest/unsubscribe-token.ts`
- Test: `tests/unit/lib/digest/unsubscribe-token.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `generateUnsubscribeToken(profileId, secret)`, `verifyUnsubscribeToken(profileId, token, secret)` — relied on by Task 6 (`lib/digest/cron-handler.ts`) and Task 8 (`lib/digest/unsubscribe.ts`)

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lib/digest/unsubscribe-token.test.ts
import { describe, it, expect } from 'vitest';
import { generateUnsubscribeToken, verifyUnsubscribeToken } from '@/lib/digest/unsubscribe-token';

describe('unsubscribe token', () => {
  const secret = 'test-secret';

  it('round-trips: a generated token verifies for the same profile and secret', () => {
    const token = generateUnsubscribeToken('profile-1', secret);
    expect(verifyUnsubscribeToken('profile-1', token, secret)).toBe(true);
  });

  it('rejects a tampered token', () => {
    const token = generateUnsubscribeToken('profile-1', secret);
    const tampered = token.slice(0, -1) + (token.at(-1) === '0' ? '1' : '0');
    expect(verifyUnsubscribeToken('profile-1', tampered, secret)).toBe(false);
  });

  it('rejects a token generated with a different secret', () => {
    const token = generateUnsubscribeToken('profile-1', 'other-secret');
    expect(verifyUnsubscribeToken('profile-1', token, secret)).toBe(false);
  });

  it('rejects a token that is valid for a different profile', () => {
    const token = generateUnsubscribeToken('profile-1', secret);
    expect(verifyUnsubscribeToken('profile-2', token, secret)).toBe(false);
  });

  it('rejects a malformed (non-hex) token without throwing', () => {
    expect(() => verifyUnsubscribeToken('profile-1', 'not-valid-hex!!', secret)).not.toThrow();
    expect(verifyUnsubscribeToken('profile-1', 'not-valid-hex!!', secret)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/digest/unsubscribe-token.test.ts`
Expected: FAIL with `Cannot find module '@/lib/digest/unsubscribe-token'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/digest/unsubscribe-token.ts
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * A stateless, verifiable link token for one-click email unsubscribe — no
 * database lookup needed to check it. HMAC-SHA256 of the profile ID, keyed
 * by DIGEST_UNSUBSCRIBE_SECRET. See
 * docs/superpowers/specs/2026-08-15-weekly-digest-delivery-design.md §4.
 */
export function generateUnsubscribeToken(profileId: string, secret: string): string {
  return createHmac('sha256', secret).update(profileId).digest('hex');
}

export function verifyUnsubscribeToken(profileId: string, token: string, secret: string): boolean {
  const expected = generateUnsubscribeToken(profileId, secret);
  const expectedBuffer = Buffer.from(expected, 'hex');
  const providedBuffer = Buffer.from(token, 'hex');
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, providedBuffer);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/digest/unsubscribe-token.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/digest/unsubscribe-token.ts tests/unit/lib/digest/unsubscribe-token.test.ts
git commit -m "feat: add stateless HMAC unsubscribe token"
```

---

### Task 3: Resend email client — `lib/integrations/resend.ts`

**Files:**
- Create: `lib/integrations/resend.ts`
- Test: `tests/unit/lib/integrations/resend.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `EmailClient`, `createResendEmailClient(apiKey, from)` — relied on by Task 6 (`lib/digest/cron-handler.ts`) and Task 7 (`app/api/cron/weekly-digest/route.ts`)

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lib/integrations/resend.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createResendEmailClient } from '@/lib/integrations/resend';

describe('createResendEmailClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the email via a POST to the Resend API with the given from address', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    const client = createResendEmailClient('test-api-key', 'Creator Dashboard <digest@example.com>');
    await client.sendEmail({ to: 'creator@example.com', subject: 'Your content ideas', html: '<p>Hi</p>' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-api-key' }),
      })
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toEqual({
      from: 'Creator Dashboard <digest@example.com>',
      to: 'creator@example.com',
      subject: 'Your content ideas',
      html: '<p>Hi</p>',
    });
  });

  it('throws when the API request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const client = createResendEmailClient('test-api-key', 'digest@example.com');
    await expect(client.sendEmail({ to: 'creator@example.com', subject: 's', html: '<p>x</p>' })).rejects.toThrow(
      'Resend API request failed with status 500'
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/integrations/resend.test.ts`
Expected: FAIL with `Cannot find module '@/lib/integrations/resend'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/integrations/resend.ts
export interface EmailClient {
  sendEmail(params: { to: string; subject: string; html: string }): Promise<void>;
}

/**
 * Plain fetch against Resend's REST API — no SDK dependency, matching every
 * other external integration in this codebase. See
 * docs/superpowers/specs/2026-08-15-weekly-digest-delivery-design.md §4.
 */
export function createResendEmailClient(apiKey: string, from: string): EmailClient {
  return {
    async sendEmail({ to, subject, html }): Promise<void> {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ from, to, subject, html }),
      });
      if (!response.ok) {
        throw new Error(`Resend API request failed with status ${response.status}`);
      }
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/integrations/resend.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/integrations/resend.ts tests/unit/lib/integrations/resend.test.ts
git commit -m "feat: add Resend email client"
```

---

### Task 4: Email template — `lib/email/weekly-digest-template.ts`

**Files:**
- Create: `lib/email/weekly-digest-template.ts`
- Test: `tests/unit/lib/email/weekly-digest-template.test.ts`

**Interfaces:**
- Consumes: `ContentIdea` from `@/lib/integrations/claude-ideas` (existing)
- Produces: `renderWeeklyDigestEmail(params)` — relied on by Task 6 (`lib/digest/cron-handler.ts`)

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lib/email/weekly-digest-template.test.ts
import { describe, it, expect } from 'vitest';
import { renderWeeklyDigestEmail } from '@/lib/email/weekly-digest-template';
import type { ContentIdea } from '@/lib/integrations/claude-ideas';

const IDEA: ContentIdea = {
  workingTitle: 'Sourdough Speedrun',
  pitch: 'Bake a loaf in under 2 hours on camera',
  medium: 'reel',
  format: 'Speed Recap',
  whyItsHotNow: 'Sourdough resurgence trending this week',
  sourceUrl: 'https://example.com/a',
  whyItRanksHere: 'High reach from trend-jacking',
  kpiSignals: ['reach'],
  reelDetails: { suggestedLengthSeconds: 60, style: 'talking-head' },
  carouselDetails: null,
};

describe('renderWeeklyDigestEmail', () => {
  it('includes the week start in the subject', () => {
    const { subject } = renderWeeklyDigestEmail({
      niche: 'home baking',
      weekStart: '2026-08-17',
      ideas: [IDEA],
      unsubscribeUrl: 'https://example.com/unsub',
    });
    expect(subject).toBe('Your content ideas for the week of 2026-08-17');
  });

  it('renders every idea and the unsubscribe link', () => {
    const { html } = renderWeeklyDigestEmail({
      niche: 'home baking',
      weekStart: '2026-08-17',
      ideas: [IDEA],
      unsubscribeUrl: 'https://example.com/unsub?profile=p1&token=abc',
    });
    expect(html).toContain('Sourdough Speedrun');
    expect(html).toContain('Bake a loaf in under 2 hours on camera');
    expect(html).toContain('Sourdough resurgence trending this week');
    expect(html).toContain('https://example.com/unsub?profile=p1&amp;token=abc');
  });

  it('escapes HTML-unsafe characters in idea content', () => {
    const unsafeIdea: ContentIdea = { ...IDEA, workingTitle: '<script>alert(1)</script>' };
    const { html } = renderWeeklyDigestEmail({
      niche: 'home baking',
      weekStart: '2026-08-17',
      ideas: [unsafeIdea],
      unsubscribeUrl: 'https://example.com/unsub',
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('renders a niche-only shell with no idea blocks when given an empty ideas array', () => {
    const { html } = renderWeeklyDigestEmail({
      niche: 'home baking',
      weekStart: '2026-08-17',
      ideas: [],
      unsubscribeUrl: 'https://example.com/unsub',
    });
    expect(html).toContain('home baking');
    expect(html).toContain('Unsubscribe');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/email/weekly-digest-template.test.ts`
Expected: FAIL with `Cannot find module '@/lib/email/weekly-digest-template'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/email/weekly-digest-template.ts
import type { ContentIdea } from '@/lib/integrations/claude-ideas';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Plain, inline-styled HTML — no external stylesheet (required for email
 * client compatibility) and no templating dependency, matching this app's
 * pattern of hand-rolling every integration rather than adding a library.
 * See docs/superpowers/specs/2026-08-15-weekly-digest-delivery-design.md §4.
 */
export function renderWeeklyDigestEmail(params: {
  niche: string;
  weekStart: string;
  ideas: ContentIdea[];
  unsubscribeUrl: string;
}): { subject: string; html: string } {
  const subject = `Your content ideas for the week of ${params.weekStart}`;

  const ideaBlocks = params.ideas
    .map(
      (idea) => `
        <div style="margin-bottom: 24px; padding-bottom: 24px; border-bottom: 1px solid #e5e7eb;">
          <h2 style="font-size: 18px; margin: 0 0 8px;">${escapeHtml(idea.workingTitle)}</h2>
          <p style="margin: 0 0 8px; color: #374151;">${escapeHtml(idea.pitch)}</p>
          <p style="margin: 0; color: #6b7280; font-size: 14px;"><strong>Why it's hot now:</strong> ${escapeHtml(idea.whyItsHotNow)}</p>
        </div>`
    )
    .join('');

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
      <h1 style="font-size: 20px; margin: 0 0 16px;">This week's content ideas for ${escapeHtml(params.niche)}</h1>
      ${ideaBlocks}
      <p style="margin-top: 32px; font-size: 12px; color: #9ca3af;">
        <a href="${escapeHtml(params.unsubscribeUrl)}" style="color: #9ca3af;">Unsubscribe from these weekly emails</a>
      </p>
    </div>`;

  return { subject, html };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/email/weekly-digest-template.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/email/weekly-digest-template.ts tests/unit/lib/email/weekly-digest-template.test.ts
git commit -m "feat: add weekly digest email template"
```

---

### Task 5: Opt-in save — `lib/digest/opt-in.ts` + route

**Files:**
- Create: `lib/digest/opt-in.ts`
- Create: `app/api/digest/opt-in/route.ts`
- Test: `tests/unit/lib/digest/opt-in.test.ts`

**Interfaces:**
- Consumes: nothing new
- Produces: `SaveDigestOptInDeps`, `SaveDigestOptInParams`, `SaveDigestOptInResult`, `saveDigestOptIn(deps, params)` — relied on by Task 10 (`app/ideas/page.tsx`, via the route below)

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lib/digest/opt-in.test.ts
import { describe, it, expect, vi } from 'vitest';
import { saveDigestOptIn } from '@/lib/digest/opt-in';

describe('saveDigestOptIn', () => {
  it('rejects turning on without a niche set, and does not save', async () => {
    const updateDigestOptIn = vi.fn();
    const result = await saveDigestOptIn(
      { getProfileNiche: async () => null, updateDigestOptIn },
      { profileId: 'p1', optIn: true }
    );
    expect(result.status).toBe(400);
    expect(updateDigestOptIn).not.toHaveBeenCalled();
  });

  it('allows turning on when a niche is set', async () => {
    const updateDigestOptIn = vi.fn().mockResolvedValue(undefined);
    const result = await saveDigestOptIn(
      { getProfileNiche: async () => 'home baking', updateDigestOptIn },
      { profileId: 'p1', optIn: true }
    );
    expect(result.status).toBe(200);
    expect(updateDigestOptIn).toHaveBeenCalledWith('p1', true);
  });

  it('always allows turning off, even without a niche set', async () => {
    const getProfileNiche = vi.fn().mockResolvedValue(null);
    const updateDigestOptIn = vi.fn().mockResolvedValue(undefined);
    const result = await saveDigestOptIn({ getProfileNiche, updateDigestOptIn }, { profileId: 'p1', optIn: false });
    expect(result.status).toBe(200);
    expect(updateDigestOptIn).toHaveBeenCalledWith('p1', false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/digest/opt-in.test.ts`
Expected: FAIL with `Cannot find module '@/lib/digest/opt-in'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/digest/opt-in.ts
export interface SaveDigestOptInDeps {
  getProfileNiche: (profileId: string) => Promise<string | null>;
  updateDigestOptIn: (profileId: string, optIn: boolean) => Promise<void>;
}

export interface SaveDigestOptInParams {
  profileId: string;
  optIn: boolean;
}

export interface SaveDigestOptInResult {
  status: number;
  body: { ok: true } | { error: string };
}

export async function saveDigestOptIn(deps: SaveDigestOptInDeps, params: SaveDigestOptInParams): Promise<SaveDigestOptInResult> {
  if (params.optIn) {
    const niche = await deps.getProfileNiche(params.profileId);
    if (!niche) {
      return { status: 400, body: { error: 'Set your niche before turning on weekly emails.' } };
    }
  }

  await deps.updateDigestOptIn(params.profileId, params.optIn);
  return { status: 200, body: { ok: true } };
}
```

```ts
// app/api/digest/opt-in/route.ts
import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { saveDigestOptIn } from '@/lib/digest/opt-in';

export async function POST(request: Request) {
  const body = (await request.json()) as { optIn?: boolean };

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'You must be signed in to change this setting.' }, { status: 401 });
  }

  const serviceClient = createSupabaseServiceRoleClient();
  const result = await saveDigestOptIn(
    {
      getProfileNiche: async (profileId) => {
        const { data } = await serviceClient.from('profiles').select('niche').eq('id', profileId).single();
        return data?.niche ?? null;
      },
      updateDigestOptIn: async (profileId, optIn) => {
        const { error } = await serviceClient.from('profiles').update({ digest_email_opt_in: optIn }).eq('id', profileId);
        if (error) {
          throw new Error(`Failed to save digest opt-in: ${error.message}`);
        }
      },
    },
    { profileId: user.id, optIn: body.optIn === true }
  );

  return NextResponse.json(result.body, { status: result.status });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/digest/opt-in.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/digest/opt-in.ts app/api/digest/opt-in/route.ts tests/unit/lib/digest/opt-in.test.ts
git commit -m "feat: add digest opt-in save logic and POST /api/digest/opt-in"
```

---

### Task 6: Cron pipeline — `lib/digest/cron-handler.ts`

**Files:**
- Create: `lib/digest/cron-handler.ts`
- Test: `tests/unit/lib/digest/cron-handler.test.ts`

**Interfaces:**
- Consumes: `ContentIdeasClient`, `ContentIdea` from `@/lib/integrations/claude-ideas` (existing); `EmailClient` from `@/lib/integrations/resend` (Task 3); `renderWeeklyDigestEmail` from `@/lib/email/weekly-digest-template` (Task 4); `weekStartKey` from `@/lib/ideas/handler` (existing); `generateUnsubscribeToken` from `@/lib/digest/unsubscribe-token` (Task 2)
- Produces: `WEEKLY_DIGEST_RUN_CAP`, `DigestCandidate`, `DigestRow`, `CronHandlerDeps`, `CronRunResult`, `buildUnsubscribeUrl(profileId, secret, appUrl)`, `runWeeklyDigestCron(deps, now)` — relied on by Task 7 (`app/api/cron/weekly-digest/route.ts`)

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lib/digest/cron-handler.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runWeeklyDigestCron, WEEKLY_DIGEST_RUN_CAP, buildUnsubscribeUrl } from '@/lib/digest/cron-handler';
import type { DigestCandidate, DigestRow, CronHandlerDeps } from '@/lib/digest/cron-handler';
import { createFakeContentIdeasClient } from '../../../fakes/claude-ideas.fake';
import type { ContentIdea } from '@/lib/integrations/claude-ideas';

const IDEA: ContentIdea = {
  workingTitle: 'Sourdough Speedrun',
  pitch: 'Bake a loaf in under 2 hours on camera',
  medium: 'reel',
  format: 'Speed Recap',
  whyItsHotNow: 'Sourdough resurgence trending this week',
  sourceUrl: 'https://example.com/a',
  whyItRanksHere: 'High reach from trend-jacking',
  kpiSignals: ['reach'],
  reelDetails: { suggestedLengthSeconds: 60, style: 'talking-head' },
  carouselDetails: null,
};

const CANDIDATE: DigestCandidate = { profileId: 'p1', email: 'creator@example.com', niche: 'home baking' };

// A Thursday — matches lib/ideas/handler.test.ts's convention of picking a
// mid-week date so weekStartKey's "go backward to Monday" branch is exercised.
const NOW = new Date('2026-08-13T12:00:00Z');
const WEEK_START = '2026-08-10';

function makeDeps(overrides: Partial<CronHandlerDeps> = {}): CronHandlerDeps {
  return {
    getOptedInCandidates: async () => [CANDIDATE],
    getExistingDigest: async () => null,
    saveDigest: async ({ profileId, weekStart, contentIdeas }) => ({
      id: 'digest-1',
      profileId,
      weekStart,
      contentIdeas,
      sentAt: null,
    }),
    markDigestSent: async () => {},
    markProfileDigestSent: async () => {},
    contentIdeasClient: createFakeContentIdeasClient([IDEA]),
    emailClient: { sendEmail: vi.fn().mockResolvedValue(undefined) },
    unsubscribeSecret: 'test-secret',
    appUrl: 'https://example.com',
    ...overrides,
  };
}

describe('runWeeklyDigestCron', () => {
  it('asks for candidates up to the run cap', async () => {
    const getOptedInCandidates = vi.fn().mockResolvedValue([]);
    await runWeeklyDigestCron(makeDeps({ getOptedInCandidates }), NOW);
    expect(getOptedInCandidates).toHaveBeenCalledWith(WEEKLY_DIGEST_RUN_CAP);
  });

  it('generates, saves, emails, and marks sent for a candidate with no existing digest', async () => {
    const sendEmail = vi.fn().mockResolvedValue(undefined);
    const markDigestSent = vi.fn().mockResolvedValue(undefined);
    const markProfileDigestSent = vi.fn().mockResolvedValue(undefined);
    const result = await runWeeklyDigestCron(
      makeDeps({ emailClient: { sendEmail }, markDigestSent, markProfileDigestSent }),
      NOW
    );

    expect(result).toEqual({ sent: ['p1'], skipped: [], failed: [] });
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'creator@example.com', subject: expect.stringContaining(WEEK_START) })
    );
    expect(markDigestSent).toHaveBeenCalledWith('digest-1', NOW);
    expect(markProfileDigestSent).toHaveBeenCalledWith('p1', NOW);
  });

  it('skips generation but still sends for a candidate with an existing, unsent digest', async () => {
    const contentIdeasClient = createFakeContentIdeasClient([IDEA]);
    const generateSpy = vi.spyOn(contentIdeasClient, 'generateContentIdeas');
    const sendEmail = vi.fn().mockResolvedValue(undefined);
    const existing: DigestRow = { id: 'digest-existing', profileId: 'p1', weekStart: WEEK_START, contentIdeas: [IDEA], sentAt: null };

    const result = await runWeeklyDigestCron(
      makeDeps({ contentIdeasClient, getExistingDigest: async () => existing, emailClient: { sendEmail } }),
      NOW
    );

    expect(generateSpy).not.toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ sent: ['p1'], skipped: [], failed: [] });
  });

  it('skips entirely — no email — for a candidate whose digest this week is already sent', async () => {
    const sendEmail = vi.fn().mockResolvedValue(undefined);
    const existing: DigestRow = {
      id: 'digest-existing',
      profileId: 'p1',
      weekStart: WEEK_START,
      contentIdeas: [IDEA],
      sentAt: '2026-08-10T13:00:00Z',
    };

    const result = await runWeeklyDigestCron(makeDeps({ getExistingDigest: async () => existing, emailClient: { sendEmail } }), NOW);

    expect(sendEmail).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: [], skipped: ['p1'], failed: [] });
  });

  it('skips without failing when generation finds zero ideas, and does not save or send', async () => {
    const saveDigest = vi.fn();
    const sendEmail = vi.fn().mockResolvedValue(undefined);
    const result = await runWeeklyDigestCron(
      makeDeps({ contentIdeasClient: createFakeContentIdeasClient([]), saveDigest, emailClient: { sendEmail } }),
      NOW
    );

    expect(saveDigest).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: [], skipped: ['p1'], failed: [] });
  });

  it('isolates one failing candidate from the rest of the run', async () => {
    const otherCandidate: DigestCandidate = { profileId: 'p2', email: 'other@example.com', niche: 'home baking' };
    const sendEmail = vi
      .fn()
      .mockRejectedValueOnce(new Error('Resend API request failed with status 500'))
      .mockResolvedValueOnce(undefined);

    const result = await runWeeklyDigestCron(
      makeDeps({ getOptedInCandidates: async () => [CANDIDATE, otherCandidate], emailClient: { sendEmail } }),
      NOW
    );

    expect(result.failed).toEqual(['p1']);
    expect(result.sent).toEqual(['p2']);
  });
});

describe('buildUnsubscribeUrl', () => {
  it('embeds the profile id and a verifiable token in the URL', () => {
    const url = buildUnsubscribeUrl('p1', 'test-secret', 'https://example.com');
    expect(url).toMatch(/^https:\/\/example\.com\/api\/digest\/unsubscribe\?profile=p1&token=[0-9a-f]+$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/digest/cron-handler.test.ts`
Expected: FAIL with `Cannot find module '@/lib/digest/cron-handler'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/digest/cron-handler.ts
import type { ContentIdeasClient, ContentIdea } from '@/lib/integrations/claude-ideas';
import type { EmailClient } from '@/lib/integrations/resend';
import { renderWeeklyDigestEmail } from '@/lib/email/weekly-digest-template';
import { weekStartKey } from '@/lib/ideas/handler';
import { generateUnsubscribeToken } from '@/lib/digest/unsubscribe-token';

export const WEEKLY_DIGEST_RUN_CAP = 200;

export interface DigestCandidate {
  profileId: string;
  email: string;
  niche: string;
}

export interface DigestRow {
  id: string;
  profileId: string;
  weekStart: string;
  contentIdeas: ContentIdea[];
  sentAt: string | null;
}

export interface CronHandlerDeps {
  getOptedInCandidates: (limit: number) => Promise<DigestCandidate[]>;
  getExistingDigest: (profileId: string, weekStart: string) => Promise<DigestRow | null>;
  saveDigest: (params: { profileId: string; weekStart: string; contentIdeas: ContentIdea[] }) => Promise<DigestRow>;
  markDigestSent: (digestId: string, sentAt: Date) => Promise<void>;
  markProfileDigestSent: (profileId: string, sentAt: Date) => Promise<void>;
  contentIdeasClient: ContentIdeasClient;
  emailClient: EmailClient;
  unsubscribeSecret: string;
  appUrl: string;
}

export interface CronRunResult {
  sent: string[];
  skipped: string[];
  failed: string[];
}

export function buildUnsubscribeUrl(profileId: string, secret: string, appUrl: string): string {
  const token = generateUnsubscribeToken(profileId, secret);
  return `${appUrl}/api/digest/unsubscribe?profile=${encodeURIComponent(profileId)}&token=${token}`;
}

/**
 * One serial pass over opted-in candidates (Approach A — see
 * docs/superpowers/specs/2026-08-15-weekly-digest-delivery-design.md §7 for
 * why a queue is deliberately out of scope for v1). Every candidate is
 * wrapped in its own try/catch so one failure never aborts the run.
 */
export async function runWeeklyDigestCron(deps: CronHandlerDeps, now: Date): Promise<CronRunResult> {
  const weekStart = weekStartKey(now);
  const candidates = await deps.getOptedInCandidates(WEEKLY_DIGEST_RUN_CAP);
  const result: CronRunResult = { sent: [], skipped: [], failed: [] };

  for (const candidate of candidates) {
    try {
      let digest = await deps.getExistingDigest(candidate.profileId, weekStart);

      if (digest && digest.sentAt) {
        // Already fully handled this week — guards a duplicate cron
        // trigger from re-emailing everyone.
        result.skipped.push(candidate.profileId);
        continue;
      }

      if (!digest) {
        const ideas = await deps.contentIdeasClient.generateContentIdeas(candidate.niche, now);
        if (ideas.length === 0) {
          // A real generation ran and genuinely found nothing honest for
          // this niche this week — not a failure, same rule as the
          // on-demand path. No row written, no email sent.
          result.skipped.push(candidate.profileId);
          continue;
        }
        digest = await deps.saveDigest({ profileId: candidate.profileId, weekStart, contentIdeas: ideas });
      }

      const { subject, html } = renderWeeklyDigestEmail({
        niche: candidate.niche,
        weekStart,
        ideas: digest.contentIdeas,
        unsubscribeUrl: buildUnsubscribeUrl(candidate.profileId, deps.unsubscribeSecret, deps.appUrl),
      });
      await deps.emailClient.sendEmail({ to: candidate.email, subject, html });
      await deps.markDigestSent(digest.id, now);
      await deps.markProfileDigestSent(candidate.profileId, now);
      result.sent.push(candidate.profileId);
    } catch (err) {
      console.error(`Weekly digest failed for profile ${candidate.profileId}:`, err);
      result.failed.push(candidate.profileId);
    }
  }

  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/digest/cron-handler.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/digest/cron-handler.ts tests/unit/lib/digest/cron-handler.test.ts
git commit -m "feat: add weekly digest cron pipeline"
```

---

### Task 7: Cron route, Vercel schedule, and setup docs

**Files:**
- Create: `app/api/cron/weekly-digest/route.ts`
- Create: `vercel.json`
- Modify: `.env.example`
- Modify: `README.md`

**Interfaces:**
- Consumes: `runWeeklyDigestCron`, `DigestRow` from `@/lib/digest/cron-handler` (Task 6); `createResendEmailClient` from `@/lib/integrations/resend` (Task 3); `createClaudeContentIdeasClient` from `@/lib/integrations/claude-ideas` (existing); `createSupabaseServiceRoleClient` from `@/lib/supabase/server` (existing)
- Produces: the deployed `GET /api/cron/weekly-digest` endpoint — nothing later in this plan depends on it directly (it's the pipeline's real-world entry point)

This task has no dedicated unit test — it's a thin wrapper supplying real dependencies to the already-tested `runWeeklyDigestCron`, the same convention this codebase uses for every other `route.ts` (see `app/api/ideas/route.ts`, which also has no direct test — its behavior is covered by `lib/ideas/handler.test.ts` plus the page-level tests).

- [ ] **Step 1: Write the route**

```ts
// app/api/cron/weekly-digest/route.ts
import { NextResponse } from 'next/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { createClaudeContentIdeasClient } from '@/lib/integrations/claude-ideas';
import { createResendEmailClient } from '@/lib/integrations/resend';
import { runWeeklyDigestCron } from '@/lib/digest/cron-handler';
import type { DigestRow } from '@/lib/digest/cron-handler';
import type { ContentIdea } from '@/lib/integrations/claude-ideas';

function mapDigestRow(row: {
  id: string;
  profile_id: string;
  week_start: string;
  content_ideas: unknown;
  sent_at: string | null;
}): DigestRow {
  return {
    id: row.id,
    profileId: row.profile_id,
    weekStart: row.week_start,
    contentIdeas: row.content_ideas as ContentIdea[],
    sentAt: row.sent_at,
  };
}

// Verifies the request actually came from the scheduler, not an arbitrary
// caller. NOTE for implementers: this repo's own AGENTS.md warns training
// data about this stack may be stale — verify Vercel's current documented
// cron-authentication mechanism before relying on this exact header shape;
// the fixed requirement is "reject anything that doesn't prove it came from
// the scheduled trigger," not this literal implementation.
function isAuthorizedCronRequest(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return request.headers.get('authorization') === `Bearer ${expected}`;
}

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const serviceClient = createSupabaseServiceRoleClient();
  const appUrl = new URL(request.url).origin;

  const result = await runWeeklyDigestCron(
    {
      getOptedInCandidates: async (limit) => {
        const { data } = await serviceClient
          .from('profiles')
          .select('id, email, niche')
          .eq('digest_email_opt_in', true)
          .not('niche', 'is', null)
          .order('digest_last_sent_at', { ascending: true, nullsFirst: true })
          .limit(limit);
        return (data ?? []).map((row) => ({ profileId: row.id, email: row.email, niche: row.niche as string }));
      },
      getExistingDigest: async (profileId, weekStart) => {
        const { data } = await serviceClient
          .from('weekly_digests')
          .select('*')
          .eq('profile_id', profileId)
          .eq('week_start', weekStart)
          .maybeSingle();
        return data ? mapDigestRow(data) : null;
      },
      saveDigest: async ({ profileId, weekStart, contentIdeas }) => {
        const { data, error } = await serviceClient
          .from('weekly_digests')
          .insert({ profile_id: profileId, week_start: weekStart, content_ideas: contentIdeas })
          .select('*')
          .single();
        if (error || !data) {
          throw new Error(`Failed to save weekly digest: ${error?.message}`);
        }
        return mapDigestRow(data);
      },
      markDigestSent: async (digestId, sentAt) => {
        await serviceClient.from('weekly_digests').update({ sent_at: sentAt.toISOString() }).eq('id', digestId);
      },
      markProfileDigestSent: async (profileId, sentAt) => {
        await serviceClient.from('profiles').update({ digest_last_sent_at: sentAt.toISOString() }).eq('id', profileId);
      },
      contentIdeasClient: createClaudeContentIdeasClient(process.env.ANTHROPIC_API_KEY ?? ''),
      emailClient: createResendEmailClient(process.env.RESEND_API_KEY ?? '', process.env.DIGEST_FROM_EMAIL ?? ''),
      unsubscribeSecret: process.env.DIGEST_UNSUBSCRIBE_SECRET ?? '',
      appUrl,
    },
    new Date()
  );

  return NextResponse.json(result);
}
```

- [ ] **Step 2: Add the Vercel Cron schedule**

```json
// vercel.json
{
  "crons": [{ "path": "/api/cron/weekly-digest", "schedule": "0 13 * * 1" }]
}
```

Monday 13:00 UTC (mid-morning US Eastern) — arbitrary but reasonable; adjust the schedule string later if needed.

- [ ] **Step 3: Document the new environment variables**

Append to `.env.example` (after the existing `RATE_LIMIT_IP_SALT` block, before the `TRUSTED_PROXY_HOPS` comment):

```
# Resend — https://resend.com/api-keys (weekly digest email delivery)
RESEND_API_KEY=
# Must be a Resend-verified sending domain, e.g. "Creator Dashboard <digest@yourdomain.com>"
DIGEST_FROM_EMAIL=

# Signs one-click unsubscribe links — generate with `openssl rand -hex 32`
DIGEST_UNSUBSCRIBE_SECRET=

# Verifies /api/cron/weekly-digest requests actually came from the
# scheduler — generate with `openssl rand -hex 32`
CRON_SECRET=
```

- [ ] **Step 4: Add a README setup note**

Append a new section to `README.md`, after the "Connecting a real Supabase project" section:

```markdown
## Weekly digest email delivery

The `/ideas` opt-in toggle emails a creator's weekly content ideas every
Monday morning via a Vercel Cron job (`vercel.json`) hitting
`/api/cron/weekly-digest`. To enable it on a real deployment:

1. Create a [Resend](https://resend.com) account, verify a sending domain,
   and set `RESEND_API_KEY` and `DIGEST_FROM_EMAIL` (an address on that
   verified domain).
2. Generate `DIGEST_UNSUBSCRIBE_SECRET` and `CRON_SECRET` with
   `openssl rand -hex 32` each and set them in the Vercel dashboard.
3. Vercel Cron is enabled automatically once `vercel.json` is deployed —
   no separate dashboard step needed on a paid plan. Confirm your plan
   supports the schedule in `vercel.json` before relying on it.
```

- [ ] **Step 5: Run the full test suite and typecheck to confirm nothing broke**

Run: `npx vitest run && npm run typecheck`
Expected: PASS (this task adds no new tests of its own, but must not break existing ones)

- [ ] **Step 6: Commit**

```bash
git add app/api/cron/weekly-digest/route.ts vercel.json .env.example README.md
git commit -m "feat: add weekly digest cron route, Vercel schedule, and setup docs"
```

---

### Task 8: Unsubscribe — `lib/digest/unsubscribe.ts` + route + confirmation page

**Files:**
- Create: `lib/digest/unsubscribe.ts`
- Create: `app/api/digest/unsubscribe/route.ts`
- Create: `app/digest/unsubscribed/page.tsx`
- Test: `tests/unit/lib/digest/unsubscribe.test.ts`
- Test: `tests/unit/app/digest/unsubscribed/page.test.tsx`

**Interfaces:**
- Consumes: `verifyUnsubscribeToken` from `@/lib/digest/unsubscribe-token` (Task 2)
- Produces: `handleUnsubscribe(deps, params)` — used only by the route in this task; nothing later in this plan depends on it

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lib/digest/unsubscribe.test.ts
import { describe, it, expect, vi } from 'vitest';
import { handleUnsubscribe } from '@/lib/digest/unsubscribe';

describe('handleUnsubscribe', () => {
  it('reports invalid and does not opt out when the profile id is missing', async () => {
    const setOptOut = vi.fn();
    const result = await handleUnsubscribe(
      { verifyToken: () => true, setOptOut },
      { profileId: null, token: 'abc' }
    );
    expect(result.status).toBe('invalid');
    expect(setOptOut).not.toHaveBeenCalled();
  });

  it('reports invalid and does not opt out when the token is missing', async () => {
    const setOptOut = vi.fn();
    const result = await handleUnsubscribe(
      { verifyToken: () => true, setOptOut },
      { profileId: 'p1', token: null }
    );
    expect(result.status).toBe('invalid');
    expect(setOptOut).not.toHaveBeenCalled();
  });

  it('reports invalid and does not opt out when the token fails verification', async () => {
    const setOptOut = vi.fn();
    const result = await handleUnsubscribe(
      { verifyToken: () => false, setOptOut },
      { profileId: 'p1', token: 'bad-token' }
    );
    expect(result.status).toBe('invalid');
    expect(setOptOut).not.toHaveBeenCalled();
  });

  it('opts the profile out and reports ok when the token verifies', async () => {
    const setOptOut = vi.fn().mockResolvedValue(undefined);
    const result = await handleUnsubscribe(
      { verifyToken: () => true, setOptOut },
      { profileId: 'p1', token: 'good-token' }
    );
    expect(result.status).toBe('ok');
    expect(setOptOut).toHaveBeenCalledWith('p1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/digest/unsubscribe.test.ts`
Expected: FAIL with `Cannot find module '@/lib/digest/unsubscribe'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/digest/unsubscribe.ts
export interface UnsubscribeDeps {
  verifyToken: (profileId: string, token: string) => boolean;
  setOptOut: (profileId: string) => Promise<void>;
}

export interface UnsubscribeParams {
  profileId: string | null;
  token: string | null;
}

export interface UnsubscribeResult {
  status: 'ok' | 'invalid';
}

export async function handleUnsubscribe(deps: UnsubscribeDeps, params: UnsubscribeParams): Promise<UnsubscribeResult> {
  if (!params.profileId || !params.token || !deps.verifyToken(params.profileId, params.token)) {
    return { status: 'invalid' };
  }
  await deps.setOptOut(params.profileId);
  return { status: 'ok' };
}
```

```ts
// app/api/digest/unsubscribe/route.ts
import { NextResponse } from 'next/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { verifyUnsubscribeToken } from '@/lib/digest/unsubscribe-token';
import { handleUnsubscribe } from '@/lib/digest/unsubscribe';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const serviceClient = createSupabaseServiceRoleClient();
  const secret = process.env.DIGEST_UNSUBSCRIBE_SECRET ?? '';

  const result = await handleUnsubscribe(
    {
      verifyToken: (profileId, token) => verifyUnsubscribeToken(profileId, token, secret),
      setOptOut: async (profileId) => {
        await serviceClient.from('profiles').update({ digest_email_opt_in: false }).eq('id', profileId);
      },
    },
    { profileId: url.searchParams.get('profile'), token: url.searchParams.get('token') }
  );

  return NextResponse.redirect(new URL(`/digest/unsubscribed?status=${result.status}`, url.origin));
}
```

```tsx
// app/digest/unsubscribed/page.tsx
'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

function UnsubscribedPageInner() {
  const searchParams = useSearchParams();
  const status = searchParams.get('status');

  if (status === 'invalid') {
    return (
      <main className="mx-auto flex max-w-md flex-col gap-4 px-6 py-16 text-center">
        <h1 className="text-2xl font-bold text-gray-900">That link didn&apos;t work</h1>
        <p className="text-gray-600">
          This unsubscribe link is invalid or has expired. If you&apos;re still getting emails you don&apos;t want, sign in and turn
          off the toggle on the Weekly Content Ideas page.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 px-6 py-16 text-center">
      <h1 className="text-2xl font-bold text-gray-900">You&apos;re unsubscribed</h1>
      <p className="text-gray-600">
        You won&apos;t get any more weekly content idea emails. You can turn them back on anytime from the Weekly Content Ideas
        page.
      </p>
    </main>
  );
}

export default function UnsubscribedPage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <UnsubscribedPageInner />
    </Suspense>
  );
}
```

```tsx
// tests/unit/app/digest/unsubscribed/page.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

let searchParams = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParams,
}));

import UnsubscribedPage from '@/app/digest/unsubscribed/page';

describe('UnsubscribedPage', () => {
  afterEach(() => {
    searchParams = new URLSearchParams();
  });

  it('shows a confirmation when status is ok', () => {
    searchParams = new URLSearchParams({ status: 'ok' });
    render(<UnsubscribedPage />);
    expect(screen.getByRole('heading', { name: /you're unsubscribed/i })).toBeInTheDocument();
  });

  it('shows an error message when status is invalid', () => {
    searchParams = new URLSearchParams({ status: 'invalid' });
    render(<UnsubscribedPage />);
    expect(screen.getByRole('heading', { name: /that link didn't work/i })).toBeInTheDocument();
  });
});
```

Note: this test file needs `import { vi, afterEach } from 'vitest';` added alongside `describe, it, expect` in Step 1's import line — write the final import as:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/lib/digest/unsubscribe.test.ts tests/unit/app/digest/unsubscribed/page.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/digest/unsubscribe.ts app/api/digest/unsubscribe/route.ts app/digest/unsubscribed/page.tsx tests/unit/lib/digest/unsubscribe.test.ts tests/unit/app/digest/unsubscribed/page.test.tsx
git commit -m "feat: add one-click digest unsubscribe route and confirmation page"
```

---

### Task 9: `/ideas` page state machine — thread `digestEmailOptIn` through

**Files:**
- Modify: `lib/ideas/page-state.ts` (full rewrite — the state shape changes)
- Modify: `tests/unit/lib/ideas/page-state.test.ts` (full rewrite — same reason)

**Interfaces:**
- Consumes: `isValidEmailFormat` from `@/lib/auth/sign-in-flow-state` (existing); `ContentIdea` from `@/lib/integrations/claude-ideas` (existing)
- Produces: `hasDigestOptInState(state)` (new), plus `IdeasPageState`/`IdeasPageEvent`/`ideasPageReducer` all gaining `digestEmailOptIn`/`digestOptInError` — relied on by Task 10 (`app/ideas/page.tsx`)

- [ ] **Step 1: Write the failing test**

Replace the entire contents of `tests/unit/lib/ideas/page-state.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import {
  ideasPageReducer,
  createInitialIdeasPageState,
  isNicheEditingState,
  hasDigestOptInState,
  type IdeasPageState,
} from '@/lib/ideas/page-state';
import type { ContentIdea } from '@/lib/integrations/claude-ideas';

const IDEA: ContentIdea = {
  workingTitle: 'Sourdough Speedrun',
  pitch: 'Bake a loaf in under 2 hours on camera',
  medium: 'reel',
  format: 'Speed Recap',
  whyItsHotNow: 'Sourdough resurgence trending this week',
  sourceUrl: 'https://example.com/a',
  whyItRanksHere: 'High reach from trend-jacking',
  kpiSignals: ['reach'],
  reelDetails: { suggestedLengthSeconds: 60, style: 'talking-head' },
  carouselDetails: null,
};

describe('createInitialIdeasPageState', () => {
  it('starts in loading', () => {
    expect(createInitialIdeasPageState()).toEqual({ status: 'loading' });
  });
});

describe('ideasPageReducer — bootstrap', () => {
  it('moves to needsNiche when no niche is set', () => {
    const next = ideasPageReducer(
      { status: 'loading' },
      { type: 'BOOTSTRAPPED', niche: '', ideas: null, digestEmailOptIn: false }
    );
    expect(next).toEqual({ status: 'needsNiche', niche: '', error: null, digestEmailOptIn: false, digestOptInError: null });
  });

  it('moves to readyToGenerate when a niche is already set and no digest exists yet', () => {
    const next = ideasPageReducer(
      { status: 'loading' },
      { type: 'BOOTSTRAPPED', niche: 'home baking', ideas: null, digestEmailOptIn: true }
    );
    expect(next).toEqual({ status: 'readyToGenerate', niche: 'home baking', digestEmailOptIn: true, digestOptInError: null });
  });

  it('moves straight to ideasReady when this week already has a digest', () => {
    const next = ideasPageReducer(
      { status: 'loading' },
      { type: 'BOOTSTRAPPED', niche: 'home baking', ideas: [IDEA], digestEmailOptIn: true }
    );
    expect(next).toEqual({
      status: 'ideasReady',
      niche: 'home baking',
      ideas: [IDEA],
      digestEmailOptIn: true,
      digestOptInError: null,
    });
  });

  it('moves to needsNiche with an error on BOOTSTRAP_FAILED', () => {
    const next = ideasPageReducer({ status: 'loading' }, { type: 'BOOTSTRAP_FAILED' });
    expect(next).toEqual({
      status: 'needsNiche',
      niche: '',
      error: "We couldn't load your content ideas settings. Please refresh and try again.",
      digestEmailOptIn: false,
      digestOptInError: null,
    });
  });

  it('moves to needsSignIn on BOOTSTRAP_UNAUTHORIZED', () => {
    const next = ideasPageReducer({ status: 'loading' }, { type: 'BOOTSTRAP_UNAUTHORIZED' });
    expect(next).toEqual({ status: 'needsSignIn', email: '', notice: null });
  });
});

describe('ideasPageReducer — niche editing', () => {
  it('updates the niche field from needsNiche', () => {
    const state: IdeasPageState = { status: 'needsNiche', niche: '', error: null, digestEmailOptIn: false, digestOptInError: null };
    expect(ideasPageReducer(state, { type: 'NICHE_CHANGED', value: 'home baking' })).toEqual({
      status: 'needsNiche',
      niche: 'home baking',
      error: null,
      digestEmailOptIn: false,
      digestOptInError: null,
    });
  });

  it('ignores NICHE_CHANGED while generating (impossible-state guard)', () => {
    const state: IdeasPageState = {
      status: 'generating',
      niche: 'home baking',
      stillWorking: false,
      digestEmailOptIn: false,
      digestOptInError: null,
    };
    expect(ideasPageReducer(state, { type: 'NICHE_CHANGED', value: 'x' })).toBe(state);
  });

  it('moves needsNiche to readyToGenerate on NICHE_SAVED', () => {
    const state: IdeasPageState = {
      status: 'needsNiche',
      niche: 'home baking',
      error: null,
      digestEmailOptIn: false,
      digestOptInError: null,
    };
    expect(ideasPageReducer(state, { type: 'NICHE_SAVED' })).toEqual({
      status: 'readyToGenerate',
      niche: 'home baking',
      digestEmailOptIn: false,
      digestOptInError: null,
    });
  });

  it('preserves the niche and sets an error on NICHE_SAVE_FAILED', () => {
    const state: IdeasPageState = {
      status: 'needsNiche',
      niche: 'x'.repeat(201),
      error: null,
      digestEmailOptIn: false,
      digestOptInError: null,
    };
    expect(ideasPageReducer(state, { type: 'NICHE_SAVE_FAILED', error: 'boom' })).toEqual({
      status: 'needsNiche',
      niche: 'x'.repeat(201),
      error: 'boom',
      digestEmailOptIn: false,
      digestOptInError: null,
    });
  });

  it('returns from ideasReady to readyToGenerate on EDIT_NICHE', () => {
    const state: IdeasPageState = {
      status: 'ideasReady',
      niche: 'home baking',
      ideas: [IDEA],
      digestEmailOptIn: true,
      digestOptInError: null,
    };
    expect(ideasPageReducer(state, { type: 'EDIT_NICHE' })).toEqual({
      status: 'readyToGenerate',
      niche: 'home baking',
      digestEmailOptIn: true,
      digestOptInError: null,
    });
  });
});

describe('ideasPageReducer — generation', () => {
  const niche = 'home baking';

  it('moves readyToGenerate to generating on GENERATE', () => {
    const state: IdeasPageState = { status: 'readyToGenerate', niche, digestEmailOptIn: true, digestOptInError: null };
    expect(ideasPageReducer(state, { type: 'GENERATE' })).toEqual({
      status: 'generating',
      niche,
      stillWorking: false,
      digestEmailOptIn: true,
      digestOptInError: null,
    });
  });

  it('also allows GENERATE to retry from generationFailed', () => {
    const state: IdeasPageState = {
      status: 'generationFailed',
      niche,
      error: 'boom',
      digestEmailOptIn: false,
      digestOptInError: null,
    };
    expect(ideasPageReducer(state, { type: 'GENERATE' })).toEqual({
      status: 'generating',
      niche,
      stillWorking: false,
      digestEmailOptIn: false,
      digestOptInError: null,
    });
  });

  it('sets stillWorking on GENERATE_STILL_WORKING without changing status', () => {
    const state: IdeasPageState = {
      status: 'generating',
      niche,
      stillWorking: false,
      digestEmailOptIn: false,
      digestOptInError: null,
    };
    expect(ideasPageReducer(state, { type: 'GENERATE_STILL_WORKING' })).toEqual({ ...state, stillWorking: true });
  });

  it('moves to ideasReady on GENERATE_SUCCESS', () => {
    const state: IdeasPageState = {
      status: 'generating',
      niche,
      stillWorking: true,
      digestEmailOptIn: true,
      digestOptInError: null,
    };
    expect(ideasPageReducer(state, { type: 'GENERATE_SUCCESS', ideas: [IDEA] })).toEqual({
      status: 'ideasReady',
      niche,
      ideas: [IDEA],
      digestEmailOptIn: true,
      digestOptInError: null,
    });
  });

  it('moves to generationFailed preserving the niche on GENERATE_FAILED', () => {
    const state: IdeasPageState = {
      status: 'generating',
      niche,
      stillWorking: false,
      digestEmailOptIn: false,
      digestOptInError: null,
    };
    expect(ideasPageReducer(state, { type: 'GENERATE_FAILED', error: 'boom' })).toEqual({
      status: 'generationFailed',
      niche,
      error: 'boom',
      digestEmailOptIn: false,
      digestOptInError: null,
    });
  });

  it('ignores GENERATE from needsNiche (impossible-state guard)', () => {
    const state: IdeasPageState = { status: 'needsNiche', niche: '', error: null, digestEmailOptIn: false, digestOptInError: null };
    expect(ideasPageReducer(state, { type: 'GENERATE' })).toBe(state);
  });
});

describe('ideasPageReducer — digest email opt-in', () => {
  it('optimistically updates digestEmailOptIn and clears any prior error on DIGEST_OPT_IN_TOGGLED', () => {
    const state: IdeasPageState = {
      status: 'readyToGenerate',
      niche: 'home baking',
      digestEmailOptIn: false,
      digestOptInError: 'old error',
    };
    expect(ideasPageReducer(state, { type: 'DIGEST_OPT_IN_TOGGLED', optIn: true })).toEqual({
      status: 'readyToGenerate',
      niche: 'home baking',
      digestEmailOptIn: true,
      digestOptInError: null,
    });
  });

  it('reverts to the previous value and sets an error on DIGEST_OPT_IN_SAVE_FAILED', () => {
    const state: IdeasPageState = {
      status: 'ideasReady',
      niche: 'home baking',
      ideas: [IDEA],
      digestEmailOptIn: true,
      digestOptInError: null,
    };
    expect(ideasPageReducer(state, { type: 'DIGEST_OPT_IN_SAVE_FAILED', previousValue: false, error: 'boom' })).toEqual({
      status: 'ideasReady',
      niche: 'home baking',
      ideas: [IDEA],
      digestEmailOptIn: false,
      digestOptInError: 'boom',
    });
  });

  it('ignores DIGEST_OPT_IN_TOGGLED while loading (impossible-state guard)', () => {
    const state: IdeasPageState = { status: 'loading' };
    expect(ideasPageReducer(state, { type: 'DIGEST_OPT_IN_TOGGLED', optIn: true })).toBe(state);
  });
});

describe('ideasPageReducer — sign-in sub-flow', () => {
  it('updates the email field from needsSignIn', () => {
    const state: IdeasPageState = { status: 'needsSignIn', email: '', notice: null };
    expect(ideasPageReducer(state, { type: 'EMAIL_CHANGED', email: 'a@b.com' })).toEqual({
      status: 'needsSignIn',
      email: 'a@b.com',
      notice: null,
    });
  });

  it('moves to submittingMagicLink on SUBMIT_EMAIL with a valid email', () => {
    const state: IdeasPageState = { status: 'needsSignIn', email: 'a@b.com', notice: null };
    expect(ideasPageReducer(state, { type: 'SUBMIT_EMAIL' })).toEqual({ status: 'submittingMagicLink', email: 'a@b.com' });
  });

  it('ignores SUBMIT_EMAIL with an invalid email', () => {
    const state: IdeasPageState = { status: 'needsSignIn', email: 'not-an-email', notice: null };
    expect(ideasPageReducer(state, { type: 'SUBMIT_EMAIL' })).toBe(state);
  });

  it('moves to checkEmail on MAGIC_LINK_SENT', () => {
    const state: IdeasPageState = { status: 'submittingMagicLink', email: 'a@b.com' };
    expect(ideasPageReducer(state, { type: 'MAGIC_LINK_SENT' })).toEqual({ status: 'checkEmail', email: 'a@b.com' });
  });

  it('moves to magicLinkError on MAGIC_LINK_FAILED', () => {
    const state: IdeasPageState = { status: 'submittingMagicLink', email: 'a@b.com' };
    expect(ideasPageReducer(state, { type: 'MAGIC_LINK_FAILED', error: 'boom' })).toEqual({
      status: 'magicLinkError',
      email: 'a@b.com',
      error: 'boom',
    });
  });

  it('moves back to submittingMagicLink on RESEND_EMAIL', () => {
    const state: IdeasPageState = { status: 'checkEmail', email: 'a@b.com' };
    expect(ideasPageReducer(state, { type: 'RESEND_EMAIL' })).toEqual({ status: 'submittingMagicLink', email: 'a@b.com' });
  });

  it('moves back to needsSignIn on RETRY_EMAIL', () => {
    const state: IdeasPageState = { status: 'checkEmail', email: 'a@b.com' };
    expect(ideasPageReducer(state, { type: 'RETRY_EMAIL' })).toEqual({ status: 'needsSignIn', email: 'a@b.com', notice: null });
  });
});

describe('isNicheEditingState', () => {
  it('is true for needsNiche, readyToGenerate, and generationFailed', () => {
    expect(isNicheEditingState({ status: 'needsNiche', niche: '', error: null, digestEmailOptIn: false, digestOptInError: null })).toBe(
      true
    );
    expect(isNicheEditingState({ status: 'readyToGenerate', niche: 'x', digestEmailOptIn: false, digestOptInError: null })).toBe(true);
    expect(
      isNicheEditingState({ status: 'generationFailed', niche: 'x', error: 'e', digestEmailOptIn: false, digestOptInError: null })
    ).toBe(true);
  });

  it('is false for generating and ideasReady', () => {
    expect(
      isNicheEditingState({ status: 'generating', niche: 'x', stillWorking: false, digestEmailOptIn: false, digestOptInError: null })
    ).toBe(false);
    expect(
      isNicheEditingState({ status: 'ideasReady', niche: 'x', ideas: [], digestEmailOptIn: false, digestOptInError: null })
    ).toBe(false);
  });
});

describe('hasDigestOptInState', () => {
  it('is true for every niche-set or generation-related status', () => {
    expect(hasDigestOptInState({ status: 'needsNiche', niche: '', error: null, digestEmailOptIn: false, digestOptInError: null })).toBe(
      true
    );
    expect(hasDigestOptInState({ status: 'readyToGenerate', niche: 'x', digestEmailOptIn: false, digestOptInError: null })).toBe(true);
    expect(
      hasDigestOptInState({ status: 'generating', niche: 'x', stillWorking: false, digestEmailOptIn: false, digestOptInError: null })
    ).toBe(true);
    expect(hasDigestOptInState({ status: 'ideasReady', niche: 'x', ideas: [], digestEmailOptIn: false, digestOptInError: null })).toBe(
      true
    );
    expect(
      hasDigestOptInState({ status: 'generationFailed', niche: 'x', error: 'e', digestEmailOptIn: false, digestOptInError: null })
    ).toBe(true);
  });

  it('is false for loading and the sign-in sub-flow', () => {
    expect(hasDigestOptInState({ status: 'loading' })).toBe(false);
    expect(hasDigestOptInState({ status: 'needsSignIn', email: '', notice: null })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/ideas/page-state.test.ts`
Expected: FAIL — the existing `lib/ideas/page-state.ts` doesn't have `digestEmailOptIn`/`digestOptInError` fields or `hasDigestOptInState`, so most assertions mismatch and the import of `hasDigestOptInState` fails.

- [ ] **Step 3: Write minimal implementation**

Replace the entire contents of `lib/ideas/page-state.ts` with:

```ts
import { isValidEmailFormat } from '@/lib/auth/sign-in-flow-state';
import type { ContentIdea } from '@/lib/integrations/claude-ideas';

export type IdeasPageState =
  | { status: 'loading' }
  | { status: 'needsNiche'; niche: string; error: string | null; digestEmailOptIn: boolean; digestOptInError: string | null }
  | { status: 'readyToGenerate'; niche: string; digestEmailOptIn: boolean; digestOptInError: string | null }
  | {
      status: 'generating';
      niche: string;
      stillWorking: boolean;
      digestEmailOptIn: boolean;
      digestOptInError: string | null;
    }
  | {
      status: 'ideasReady';
      niche: string;
      ideas: ContentIdea[];
      digestEmailOptIn: boolean;
      digestOptInError: string | null;
      cached?: boolean;
    }
  | { status: 'generationFailed'; niche: string; error: string; digestEmailOptIn: boolean; digestOptInError: string | null }
  // Sign-in sub-flow, mirroring lib/recap/page-state.ts so the same
  // <SignInPrompt> component drives it.
  | { status: 'needsSignIn'; email: string; notice: string | null }
  | { status: 'submittingMagicLink'; email: string }
  | { status: 'checkEmail'; email: string }
  | { status: 'magicLinkError'; email: string; error: string };

export type IdeasPageEvent =
  | { type: 'BOOTSTRAPPED'; niche: string; ideas: ContentIdea[] | null; digestEmailOptIn: boolean }
  | { type: 'BOOTSTRAP_FAILED' }
  | { type: 'BOOTSTRAP_UNAUTHORIZED' }
  | { type: 'NICHE_CHANGED'; value: string }
  | { type: 'NICHE_SAVED' }
  | { type: 'NICHE_SAVE_FAILED'; error: string }
  | { type: 'GENERATE' }
  | { type: 'GENERATE_STILL_WORKING' }
  | { type: 'GENERATE_SUCCESS'; ideas: ContentIdea[]; cached?: boolean }
  | { type: 'GENERATE_FAILED'; error: string }
  | { type: 'EDIT_NICHE' }
  | { type: 'DIGEST_OPT_IN_TOGGLED'; optIn: boolean }
  | { type: 'DIGEST_OPT_IN_SAVE_FAILED'; previousValue: boolean; error: string }
  | { type: 'EMAIL_CHANGED'; email: string }
  | { type: 'SUBMIT_EMAIL' }
  | { type: 'MAGIC_LINK_SENT' }
  | { type: 'MAGIC_LINK_FAILED'; error: string }
  | { type: 'RESEND_EMAIL' }
  | { type: 'RETRY_EMAIL' };

const NICHE_EDITING_STATUSES = ['needsNiche', 'readyToGenerate', 'generationFailed'] as const;
type NicheEditingStatus = (typeof NICHE_EDITING_STATUSES)[number];

export function isNicheEditingState(state: IdeasPageState): state is Extract<IdeasPageState, { status: NicheEditingStatus }> {
  return (NICHE_EDITING_STATUSES as readonly string[]).includes(state.status);
}

const DIGEST_TOGGLE_STATUSES = ['needsNiche', 'readyToGenerate', 'generating', 'ideasReady', 'generationFailed'] as const;
type DigestToggleStatus = (typeof DIGEST_TOGGLE_STATUSES)[number];

/** True for every status that carries digestEmailOptIn — i.e. everywhere except loading and the sign-in sub-flow. */
export function hasDigestOptInState(state: IdeasPageState): state is Extract<IdeasPageState, { status: DigestToggleStatus }> {
  return (DIGEST_TOGGLE_STATUSES as readonly string[]).includes(state.status);
}

export function createInitialIdeasPageState(): IdeasPageState {
  return { status: 'loading' };
}

export function ideasPageReducer(state: IdeasPageState, event: IdeasPageEvent): IdeasPageState {
  switch (event.type) {
    case 'BOOTSTRAPPED':
      if (event.ideas) {
        return {
          status: 'ideasReady',
          niche: event.niche,
          ideas: event.ideas,
          digestEmailOptIn: event.digestEmailOptIn,
          digestOptInError: null,
        };
      }
      return event.niche
        ? { status: 'readyToGenerate', niche: event.niche, digestEmailOptIn: event.digestEmailOptIn, digestOptInError: null }
        : { status: 'needsNiche', niche: '', error: null, digestEmailOptIn: event.digestEmailOptIn, digestOptInError: null };

    case 'BOOTSTRAP_FAILED':
      return {
        status: 'needsNiche',
        niche: '',
        error: "We couldn't load your content ideas settings. Please refresh and try again.",
        digestEmailOptIn: false,
        digestOptInError: null,
      };

    case 'BOOTSTRAP_UNAUTHORIZED':
      return { status: 'needsSignIn', email: '', notice: null };

    case 'NICHE_CHANGED':
      return isNicheEditingState(state) ? { ...state, niche: event.value } : state;

    case 'NICHE_SAVED':
      if (!isNicheEditingState(state)) return state;
      return state.niche.trim()
        ? {
            status: 'readyToGenerate',
            niche: state.niche,
            digestEmailOptIn: state.digestEmailOptIn,
            digestOptInError: state.digestOptInError,
          }
        : {
            status: 'needsNiche',
            niche: state.niche,
            error: null,
            digestEmailOptIn: state.digestEmailOptIn,
            digestOptInError: state.digestOptInError,
          };

    case 'NICHE_SAVE_FAILED':
      return isNicheEditingState(state)
        ? {
            status: 'needsNiche',
            niche: state.niche,
            error: event.error,
            digestEmailOptIn: state.digestEmailOptIn,
            digestOptInError: state.digestOptInError,
          }
        : state;

    case 'GENERATE':
      return state.status === 'readyToGenerate' || state.status === 'generationFailed'
        ? {
            status: 'generating',
            niche: state.niche,
            stillWorking: false,
            digestEmailOptIn: state.digestEmailOptIn,
            digestOptInError: state.digestOptInError,
          }
        : state;

    case 'GENERATE_STILL_WORKING':
      return state.status === 'generating' ? { ...state, stillWorking: true } : state;

    case 'GENERATE_SUCCESS':
      return state.status === 'generating'
        ? {
            status: 'ideasReady',
            niche: state.niche,
            ideas: event.ideas,
            digestEmailOptIn: state.digestEmailOptIn,
            digestOptInError: state.digestOptInError,
            ...(event.cached ? { cached: true } : {}),
          }
        : state;

    case 'GENERATE_FAILED':
      return state.status === 'generating'
        ? {
            status: 'generationFailed',
            niche: state.niche,
            error: event.error,
            digestEmailOptIn: state.digestEmailOptIn,
            digestOptInError: state.digestOptInError,
          }
        : state;

    case 'EDIT_NICHE':
      return state.status === 'ideasReady'
        ? {
            status: 'readyToGenerate',
            niche: state.niche,
            digestEmailOptIn: state.digestEmailOptIn,
            digestOptInError: state.digestOptInError,
          }
        : state;

    case 'DIGEST_OPT_IN_TOGGLED':
      return hasDigestOptInState(state) ? { ...state, digestEmailOptIn: event.optIn, digestOptInError: null } : state;

    case 'DIGEST_OPT_IN_SAVE_FAILED':
      return hasDigestOptInState(state)
        ? { ...state, digestEmailOptIn: event.previousValue, digestOptInError: event.error }
        : state;

    case 'EMAIL_CHANGED':
      return state.status === 'needsSignIn' || state.status === 'magicLinkError'
        ? { ...state, email: event.email }
        : state;

    case 'SUBMIT_EMAIL':
      if (state.status !== 'needsSignIn' && state.status !== 'magicLinkError') return state;
      if (!isValidEmailFormat(state.email)) return state;
      return { status: 'submittingMagicLink', email: state.email };

    case 'MAGIC_LINK_SENT':
      return state.status === 'submittingMagicLink' ? { status: 'checkEmail', email: state.email } : state;

    case 'MAGIC_LINK_FAILED':
      return state.status === 'submittingMagicLink'
        ? { status: 'magicLinkError', email: state.email, error: event.error }
        : state;

    case 'RESEND_EMAIL':
      return state.status === 'checkEmail' ? { status: 'submittingMagicLink', email: state.email } : state;

    case 'RETRY_EMAIL':
      return state.status === 'checkEmail' ? { status: 'needsSignIn', email: state.email, notice: null } : state;

    default:
      return state;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/ideas/page-state.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full suite to confirm nothing else broke**

Run: `npx vitest run`
Expected: FAIL only in `tests/unit/app/ideas/page.test.tsx` (Task 10 fixes this — `app/ideas/page.tsx` calls `dispatch({ type: 'BOOTSTRAPPED', ... })` without the new required `digestEmailOptIn` field, which TypeScript should catch at `npm run typecheck`, or the page simply won't compile/render correctly against the new reducer types). This is expected and resolved in the next task — do not attempt to fix `app/ideas/page.tsx` in this task.

- [ ] **Step 6: Commit**

```bash
git add lib/ideas/page-state.ts tests/unit/lib/ideas/page-state.test.ts
git commit -m "feat: thread digestEmailOptIn through the ideas page state machine"
```

---

### Task 10: `/ideas` page — opt-in toggle UI

**Files:**
- Modify: `app/ideas/page.tsx`
- Modify: `app/api/ideas/route.ts` (GET only)
- Modify: `tests/unit/app/ideas/page.test.tsx` (new test cases appended)

**Interfaces:**
- Consumes: `hasDigestOptInState` from `@/lib/ideas/page-state` (Task 9); `POST /api/digest/opt-in` (Task 5) response shape
- Produces: the working `/ideas` page with the toggle — exercised end-to-end by Task 11's Playwright test

- [ ] **Step 1: Update `GET /api/ideas` to return the opt-in flag**

In `app/api/ideas/route.ts`, change the `GET` function's profile select and response body (leave `POST` untouched):

```ts
export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'You must be signed in to view your content ideas.' }, { status: 401 });
  }

  const serviceClient = createSupabaseServiceRoleClient();
  const { data: profile } = await serviceClient
    .from('profiles')
    .select('niche, digest_email_opt_in')
    .eq('id', user.id)
    .single();

  const { data: existingDigest } = await serviceClient
    .from('weekly_digests')
    .select('*')
    .eq('profile_id', user.id)
    .eq('week_start', weekStartKey(new Date()))
    .maybeSingle();

  return NextResponse.json({
    niche: profile?.niche ?? null,
    digestEmailOptIn: profile?.digest_email_opt_in ?? false,
    digest: existingDigest ? mapDigestRow(existingDigest) : null,
  });
}
```

- [ ] **Step 2: Write the failing test cases**

Append these test cases inside the existing `describe('IdeasPage', ...)` block in `tests/unit/app/ideas/page.test.tsx` (just before the final closing `});` of that block):

```ts
  it('shows the digest opt-in checkbox once a niche is set, unchecked by default', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ niche: 'home baking', digestEmailOptIn: false, digest: null }) })
    );
    render(<IdeasPage />);
    const checkbox = await screen.findByRole('checkbox', { name: /email me this every monday morning/i });
    expect(checkbox).not.toBeChecked();
  });

  it('does not show the digest opt-in checkbox before a niche is set', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ niche: null, digest: null }) }));
    render(<IdeasPage />);
    await waitFor(() => expect(screen.getByLabelText(/your niche/i)).toBeInTheDocument());
    expect(screen.queryByRole('checkbox', { name: /email me this every monday morning/i })).not.toBeInTheDocument();
  });

  it('reflects digestEmailOptIn: true from bootstrap as checked', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ niche: 'home baking', digestEmailOptIn: true, digest: null }) })
    );
    render(<IdeasPage />);
    const checkbox = await screen.findByRole('checkbox', { name: /email me this every monday morning/i });
    expect(checkbox).toBeChecked();
  });

  it('toggling the checkbox on saves via POST /api/digest/opt-in', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ niche: 'home baking', digestEmailOptIn: false, digest: null }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<IdeasPage />);
    const checkbox = await screen.findByRole('checkbox', { name: /email me this every monday morning/i });
    fireEvent.click(checkbox);

    expect(checkbox).toBeChecked();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/digest/opt-in',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ optIn: true }) })
      )
    );
  });

  it('reverts the checkbox and shows an error when saving the toggle fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ niche: 'home baking', digestEmailOptIn: false, digest: null }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Something went wrong.' }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<IdeasPage />);
    const checkbox = await screen.findByRole('checkbox', { name: /email me this every monday morning/i });
    fireEvent.click(checkbox);

    await waitFor(() => expect(checkbox).not.toBeChecked());
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong.');
  });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/app/ideas/page.test.tsx`
Expected: FAIL — no checkbox exists yet in `app/ideas/page.tsx`

- [ ] **Step 4: Write minimal implementation**

In `app/ideas/page.tsx`:

Add `hasDigestOptInState` to the existing import from `@/lib/ideas/page-state`:

```ts
import { ideasPageReducer, createInitialIdeasPageState, isNicheEditingState, hasDigestOptInState } from '@/lib/ideas/page-state';
```

Update the bootstrap fetch's success dispatch (inside the `useEffect` that calls `fetch('/api/ideas')`) from:

```ts
        dispatch({ type: 'BOOTSTRAPPED', niche: data.niche ?? '', ideas: data.digest?.contentIdeas ?? null });
```

to:

```ts
        dispatch({
          type: 'BOOTSTRAPPED',
          niche: data.niche ?? '',
          ideas: data.digest?.contentIdeas ?? null,
          digestEmailOptIn: data.digestEmailOptIn ?? false,
        });
```

Add this function alongside the existing `saveNiche`/`generate`/`submitMagicLink` functions:

```ts
  async function toggleDigestOptIn(optIn: boolean) {
    if (!hasDigestOptInState(state)) return;
    const previousValue = state.digestEmailOptIn;
    dispatch({ type: 'DIGEST_OPT_IN_TOGGLED', optIn });
    try {
      const res = await fetch('/api/digest/opt-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ optIn }),
      });
      const data = await res.json();
      if (!res.ok) {
        dispatch({ type: 'DIGEST_OPT_IN_SAVE_FAILED', previousValue, error: data.error ?? 'Something went wrong saving that.' });
      }
    } catch {
      dispatch({
        type: 'DIGEST_OPT_IN_SAVE_FAILED',
        previousValue,
        error: "We couldn't reach the server. Check your connection and try again.",
      });
    }
  }
```

Add the toggle UI right after the existing niche `<div className="flex flex-col gap-3">...</div>` block (the one containing the niche `<label>` and the "Save niche"/"Edit niche" buttons) and before the `{state.status === 'needsNiche' && state.error && ...}` block:

```tsx
      {hasDigestOptInState(state) && state.status !== 'needsNiche' && (
        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={state.digestEmailOptIn}
              onChange={(e) => toggleDigestOptIn(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            Email me this every Monday morning
          </label>
          {state.digestOptInError && (
            <p role="alert" className="text-sm text-red-600">
              {state.digestOptInError}
            </p>
          )}
        </div>
      )}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/app/ideas/page.test.tsx`
Expected: PASS

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npx vitest run && npm run typecheck && npm run lint`
Expected: PASS — this also confirms Task 9's `page-state.ts` change is now fully consumed correctly.

- [ ] **Step 7: Commit**

```bash
git add app/ideas/page.tsx app/api/ideas/route.ts tests/unit/app/ideas/page.test.tsx
git commit -m "feat: add weekly email opt-in toggle to /ideas"
```

---

### Task 11: Playwright E2E — opt-in toggle

**Files:**
- Modify: `tests/e2e/ideas-smoke.spec.ts` (new test case appended)

**Interfaces:**
- Consumes: the working `/ideas` page from Task 10
- Produces: nothing — this is the final user-facing verification for this plan's UI surface

- [ ] **Step 1: Write the test**

Append to `tests/e2e/ideas-smoke.spec.ts` (after the existing `test(...)` block):

```ts

test('toggling the weekly email option persists the change', async ({ page }) => {
  let digestEmailOptIn = false;

  await page.route('**/api/ideas', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ niche: 'home baking', digestEmailOptIn, digest: null }),
      });
      return;
    }
    await route.continue();
  });

  await page.route('**/api/digest/opt-in', async (route) => {
    const body = route.request().postDataJSON() as { optIn: boolean };
    digestEmailOptIn = body.optIn;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  await page.goto('/ideas');
  const toggle = page.getByRole('checkbox', { name: /email me this every monday morning/i });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(toggle).toBeChecked();
});
```

- [ ] **Step 2: Run the test**

Run: `npm run test:e2e -- tests/e2e/ideas-smoke.spec.ts`
Expected: PASS (both the pre-existing test and this new one)

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/ideas-smoke.spec.ts
git commit -m "test: add Playwright coverage for the digest opt-in toggle"
```

---

### Task 12: Final whole-branch review

Same closing step every prior feature branch in this repo has used (see the "final whole-branch review" commits for Sign-in flow, Weekly Content Ideas, and OAuth fast-follow).

- [ ] **Step 1: Run the full verification suite**

```bash
npx vitest run
npm run typecheck
npm run lint
npm run build
npm run test:e2e
```

Expected: all PASS. Fix anything that doesn't before proceeding.

- [ ] **Step 2: Re-read the spec end to end**

Re-read `docs/superpowers/specs/2026-08-15-weekly-digest-delivery-design.md` section by section against what was actually built. Confirm every decision, data model piece, pipeline step, and edge case has a corresponding implementation. In particular verify:

- The opt-in toggle truly cannot be turned on without a niche set (both client-side gating and the `saveDigestOptIn` server-side check).
- `runWeeklyDigestCron` genuinely never lets one candidate's failure stop the run (re-read the `try`/`catch` placement).
- The unsubscribe link in the rendered email actually points at a URL `verifyUnsubscribeToken` will accept for that same profile.
- `WEEKLY_DIGEST_RUN_CAP` and the `digest_last_sent_at`-ascending-nulls-first ordering are both actually wired into the real `getOptedInCandidates` implementation in `app/api/cron/weekly-digest/route.ts` (not just present in the pure handler's tests).

- [ ] **Step 3: Check for any TODO/FIXME left behind**

```bash
grep -rn "TODO\|FIXME" lib/digest lib/email lib/integrations/resend.ts app/api/digest app/api/cron app/digest 2>/dev/null
```

Expected: no output. If anything turns up, resolve it before committing.

- [ ] **Step 4: Commit (only if Steps 1–3 produced changes)**

```bash
git add -A
git commit -m "fix: address final whole-branch review findings for weekly digest delivery"
```

If nothing needed fixing, skip this step — there's nothing to commit.
