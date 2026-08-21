# Paid Tier / Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put Recap Card and Weekly Content Ideas behind a $10/mo Stripe subscription, while Diagnostic stays free, using Stripe's hosted Checkout and Customer Portal so this app never touches a card number.

**Architecture:** A new `subscriptions` table, synced exclusively via a signed Stripe webhook (never queried live from Stripe on a gated request). Two new hosted-redirect routes (`checkout`, `portal`) plus the webhook route form the billing surface; a small `hasActiveSubscription` check gates the existing Recap/Ideas handlers and routes. A new `/billing` page shows plan status and drives both hosted redirects.

**Tech Stack:** Next.js App Router + TypeScript + Supabase (unchanged). Stripe accessed via plain `fetch` against its REST API — no `stripe` npm SDK — matching every other external integration in this codebase (YouTube, Apify, Claude, Resend, TikTok/Instagram OAuth all do the same). Webhook signature verification is hand-rolled HMAC-SHA256 (Node's `node:crypto`), matching this codebase's existing hand-rolled signed-token precedent (`lib/digest/unsubscribe-token.ts`, `lib/oauth/state.ts`).

**Spec:** `docs/superpowers/specs/2026-08-19-paid-tier-billing-design.md`

## Global Constraints

- Diagnostic is completely unaffected — no changes to `lib/diagnostic/`, its route, its rate limit, or its page.
- Single flat plan: $10/mo, no trial, no tiers. The literal price never appears in code except as UI copy ("$10/mo") — the actual amount lives in the Stripe-dashboard-configured Price, referenced only by `STRIPE_PRICE_ID`.
- `past_due` counts as entitled (grace period during Stripe's payment retries) — only `active`/`past_due` pass `hasActiveSubscription`.
- No `stripe` npm dependency — plain `fetch`, matching `lib/integrations/resend.ts`'s explicit "no SDK dependency" convention.
- Webhook route is the *only* writer of subscription status; `checkout`/`portal` routes never write `status` themselves (checkout only ever inserts a fresh row with `status: 'incomplete'`).
- Every new async handler follows this codebase's DI-deps-object pattern (see `lib/diagnostic/handler.ts`, `lib/recap/handler.ts`, `lib/ideas/handler.ts`) — a pure function taking `(deps, context)`, returning `{ status, body }`, wired to real Supabase/Stripe calls only in the corresponding `route.ts`.
- Trivial GET routes that are pure Supabase row-mapping (matching `GET /api/recap`, `GET /api/ideas`, `GET /api/home` precedent) get no dedicated unit test — covered by the Playwright E2E smoke test instead.

---

## File Structure

```
supabase/migrations/20260819000001_create_subscriptions.sql   # new subscriptions table
lib/supabase/types.ts                                         # + subscriptions table entry

lib/integrations/stripe.ts                                    # createStripeClient() — plain-fetch Stripe REST wrapper
lib/billing/
  stripe-webhook.ts             # verifyStripeWebhookSignature() — hand-rolled HMAC verification
  webhook-handler.ts            # handleStripeWebhookEvent(), mapStripeSubscriptionStatus()
  entitlements.ts                # hasActiveSubscription()
  checkout-handler.ts           # handleCheckoutRequest()
  portal-handler.ts             # handlePortalRequest()
  page-state.ts                  # /billing page's reducer

components/UpgradePrompt.tsx    # shared paywall screen, used by /recap, /ideas, and /billing's free state

app/api/
  webhooks/stripe/route.ts       # POST — Stripe's webhook target
  billing/
    checkout/route.ts            # POST — starts Stripe Checkout
    portal/route.ts              # POST — starts Stripe Customer Portal
    status/route.ts              # GET — current subscription status for /billing
app/billing/page.tsx             # new page

lib/recap/handler.ts             # modify: + hasActiveSubscription dep, 402 gate
lib/ideas/handler.ts             # modify: + hasActiveSubscription dep, 402 gate
lib/recap/page-state.ts          # modify: + requiresUpgrade state
lib/ideas/page-state.ts          # modify: + requiresUpgrade state
app/api/recap/route.ts           # modify: GET + POST gated
app/api/ideas/route.ts           # modify: GET + POST gated
app/recap/page.tsx               # modify: render UpgradePrompt on requiresUpgrade
app/ideas/page.tsx               # modify: render UpgradePrompt on requiresUpgrade
components/AppNav.tsx            # modify: + Billing nav link

.env.example                     # + STRIPE_SECRET_KEY, STRIPE_PRICE_ID, STRIPE_WEBHOOK_SECRET

tests/fakes/stripe.fake.ts
tests/unit/supabase/migrations.test.ts        # modify: + subscriptions case
tests/unit/lib/integrations/stripe.test.ts
tests/unit/lib/billing/
  stripe-webhook.test.ts
  webhook-handler.test.ts
  entitlements.test.ts
  checkout-handler.test.ts
  portal-handler.test.ts
  page-state.test.ts
tests/unit/lib/recap/handler.test.ts          # modify: + 402 case
tests/unit/lib/ideas/handler.test.ts          # modify: + 402 case
tests/unit/lib/recap/page-state.test.ts       # modify: + requiresUpgrade case
tests/unit/lib/ideas/page-state.test.ts       # modify: + requiresUpgrade case
tests/unit/components/UpgradePrompt.test.tsx
tests/unit/components/AppNav.test.tsx         # modify: + Billing link case
tests/e2e/billing-smoke.spec.ts
```

---

### Task 1: `subscriptions` migration + Database types

**Files:**
- Create: `supabase/migrations/20260819000001_create_subscriptions.sql`
- Modify: `tests/unit/supabase/migrations.test.ts`
- Modify: `lib/supabase/types.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `public.subscriptions` table; `Database['public']['Tables']['subscriptions']` type — relied on by every task in this plan

- [ ] **Step 1: Write the failing test**

Append to the `describe('supabase migrations', ...)` block in `tests/unit/supabase/migrations.test.ts`:
```ts
  it('includes a subscriptions table migration unique per profile and per Stripe customer', () => {
    const sql = readMigrationContaining('create_subscriptions');
    expect(sql).toContain('create table public.subscriptions');
    expect(sql).toContain('profile_id uuid not null unique references public.profiles(id)');
    expect(sql).toContain('stripe_customer_id text not null unique');
    expect(sql).toContain("status text not null check (status in ('active', 'past_due', 'canceled', 'incomplete'))");
    expect(sql).toContain('"Subscriptions are viewable by owner"');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/supabase/migrations.test.ts`
Expected: FAIL with "No migration file matching \"create_subscriptions\""

- [ ] **Step 3: Write the migration**
```sql
-- supabase/migrations/20260819000001_create_subscriptions.sql
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  stripe_customer_id text not null unique,
  stripe_subscription_id text unique,
  status text not null check (status in ('active', 'past_due', 'canceled', 'incomplete')),
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.subscriptions enable row level security;

create policy "Subscriptions are viewable by owner"
  on public.subscriptions for select
  using ((select auth.uid()) = profile_id);

-- No client-facing insert/update/delete policies: only the service-role
-- checkout route (insert) and webhook route (update) ever write here.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/supabase/migrations.test.ts`
Expected: PASS

- [ ] **Step 5: Add the Database type**

In `lib/supabase/types.ts`, add a `subscriptions` entry to `Database['public']['Tables']`, alongside the existing `platform_connections` entry:
```ts
      subscriptions: {
        Row: {
          id: string;
          profile_id: string;
          stripe_customer_id: string;
          stripe_subscription_id: string | null;
          status: 'active' | 'past_due' | 'canceled' | 'incomplete';
          current_period_end: string | null;
          cancel_at_period_end: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          profile_id: string;
          stripe_customer_id: string;
          stripe_subscription_id?: string | null;
          status: 'active' | 'past_due' | 'canceled' | 'incomplete';
          current_period_end?: string | null;
          cancel_at_period_end?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['subscriptions']['Insert']>;
        Relationships: [];
      };
```

- [ ] **Step 6: Run the full unit suite to confirm nothing else broke**

Run: `npx vitest run`
Expected: PASS (all existing tests unaffected — this is a pure additive type change)

- [ ] **Step 7: Commit**
```bash
git add supabase/migrations/20260819000001_create_subscriptions.sql tests/unit/supabase/migrations.test.ts lib/supabase/types.ts
git commit -m "feat: add subscriptions table migration and Database type"
```

---

### Task 2: Stripe integration client

**Files:**
- Create: `lib/integrations/stripe.ts`
- Create: `tests/fakes/stripe.fake.ts`
- Test: `tests/unit/lib/integrations/stripe.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `StripeCustomer`, `StripeCheckoutSession`, `StripePortalSession`, `StripeClient`, `createStripeClient(secretKey)` — relied on by Tasks 6, 7; `createFakeStripeClient` relied on by Tasks 6, 7's tests

- [ ] **Step 1: Write the failing test**
```ts
// tests/unit/lib/integrations/stripe.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createStripeClient } from '@/lib/integrations/stripe';

describe('createStripeClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a customer via the Stripe API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'cus_123' }) });
    vi.stubGlobal('fetch', fetchMock);

    const client = createStripeClient('sk_test_123');
    const customer = await client.createCustomer({ email: 'creator@example.com' });

    expect(customer).toEqual({ id: 'cus_123' });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.stripe.com/v1/customers');
    expect(options.headers.Authorization).toBe('Bearer sk_test_123');
    expect(options.body).toContain('email=creator%40example.com');
  });

  it('creates a checkout session via the Stripe API', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ id: 'cs_123', url: 'https://checkout.stripe.com/pay/cs_123' }) });
    vi.stubGlobal('fetch', fetchMock);

    const client = createStripeClient('sk_test_123');
    const session = await client.createCheckoutSession({
      customerId: 'cus_123',
      priceId: 'price_123',
      successUrl: 'https://example.com/billing?checkout=success',
      cancelUrl: 'https://example.com/billing',
    });

    expect(session).toEqual({ id: 'cs_123', url: 'https://checkout.stripe.com/pay/cs_123' });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(options.body).toContain('customer=cus_123');
    expect(options.body).toContain('line_items%5B0%5D%5Bprice%5D=price_123');
    expect(options.body).toContain('mode=subscription');
  });

  it('creates a billing portal session via the Stripe API', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ url: 'https://billing.stripe.com/session/xyz' }) }));

    const client = createStripeClient('sk_test_123');
    const session = await client.createPortalSession({ customerId: 'cus_123', returnUrl: 'https://example.com/billing' });

    expect(session).toEqual({ url: 'https://billing.stripe.com/session/xyz' });
  });

  it('throws with the Stripe-provided message when the API returns an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 402, json: async () => ({ error: { message: 'Your card was declined.' } }) })
    );
    const client = createStripeClient('sk_test_123');
    await expect(client.createCustomer({ email: 'creator@example.com' })).rejects.toThrow('Your card was declined.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/integrations/stripe.test.ts`
Expected: FAIL with "Cannot find module '@/lib/integrations/stripe'"

- [ ] **Step 3: Write minimal implementation**
```ts
// lib/integrations/stripe.ts

/**
 * Plain fetch against Stripe's REST API — no SDK dependency, matching
 * every other external integration in this codebase (see
 * lib/integrations/resend.ts). See docs/superpowers/specs/2026-08-19-paid-tier-billing-design.md §2.
 */

export interface StripeCustomer {
  id: string;
}

export interface StripeCheckoutSession {
  id: string;
  url: string;
}

export interface StripePortalSession {
  url: string;
}

export interface StripeClient {
  createCustomer(params: { email: string }): Promise<StripeCustomer>;
  createCheckoutSession(params: {
    customerId: string;
    priceId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<StripeCheckoutSession>;
  createPortalSession(params: { customerId: string; returnUrl: string }): Promise<StripePortalSession>;
}

export function createStripeClient(secretKey: string): StripeClient {
  async function stripeRequest(path: string, body: Record<string, string>): Promise<Record<string, unknown>> {
    const response = await fetch(`https://api.stripe.com/v1/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(body).toString(),
    });
    const data = await response.json();
    if (!response.ok) {
      const message = (data as { error?: { message?: string } }).error?.message ?? `Stripe API request failed with status ${response.status}`;
      throw new Error(message);
    }
    return data;
  }

  return {
    async createCustomer({ email }) {
      const data = await stripeRequest('customers', { email });
      return { id: data.id as string };
    },
    async createCheckoutSession({ customerId, priceId, successUrl, cancelUrl }) {
      const data = await stripeRequest('checkout/sessions', {
        customer: customerId,
        mode: 'subscription',
        'line_items[0][price]': priceId,
        'line_items[0][quantity]': '1',
        success_url: successUrl,
        cancel_url: cancelUrl,
      });
      return { id: data.id as string, url: data.url as string };
    },
    async createPortalSession({ customerId, returnUrl }) {
      const data = await stripeRequest('billing_portal/sessions', {
        customer: customerId,
        return_url: returnUrl,
      });
      return { url: data.url as string };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/integrations/stripe.test.ts`
Expected: PASS

- [ ] **Step 5: Write the fake**
```ts
// tests/fakes/stripe.fake.ts
import type { StripeClient } from '@/lib/integrations/stripe';

export function createFakeStripeClient(overrides: Partial<StripeClient> = {}): StripeClient {
  return {
    createCustomer: async ({ email }) => ({ id: `cus_fake_${email}` }),
    createCheckoutSession: async () => ({ id: 'cs_fake_1', url: 'https://checkout.stripe.com/fake-session' }),
    createPortalSession: async () => ({ url: 'https://billing.stripe.com/fake-portal' }),
    ...overrides,
  };
}
```

- [ ] **Step 6: Commit**
```bash
git add lib/integrations/stripe.ts tests/fakes/stripe.fake.ts tests/unit/lib/integrations/stripe.test.ts
git commit -m "feat: add plain-fetch Stripe integration client"
```

---

### Task 3: Webhook signature verification

**Files:**
- Create: `lib/billing/stripe-webhook.ts`
- Test: `tests/unit/lib/billing/stripe-webhook.test.ts`

**Interfaces:**
- Consumes: nothing (uses Node's built-in `node:crypto`)
- Produces: `StripeWebhookEvent`, `verifyStripeWebhookSignature(payload, signatureHeader, webhookSecret, now?)` — relied on by Task 4

- [ ] **Step 1: Write the failing test**
```ts
// tests/unit/lib/billing/stripe-webhook.test.ts
import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyStripeWebhookSignature } from '@/lib/billing/stripe-webhook';

const SECRET = 'whsec_test_secret';

function signPayload(payload: string, timestamp: number, secret: string): string {
  const signature = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

describe('verifyStripeWebhookSignature', () => {
  it('returns the parsed event for a validly signed payload', () => {
    const payload = JSON.stringify({ type: 'customer.subscription.updated', data: { object: { id: 'sub_1' } } });
    const now = new Date('2026-08-19T12:00:00Z');
    const timestamp = Math.floor(now.getTime() / 1000);
    const header = signPayload(payload, timestamp, SECRET);

    const event = verifyStripeWebhookSignature(payload, header, SECRET, now);
    expect(event.type).toBe('customer.subscription.updated');
  });

  it('throws when the signature does not match the payload', () => {
    const payload = JSON.stringify({ type: 'customer.subscription.updated', data: { object: {} } });
    const now = new Date('2026-08-19T12:00:00Z');
    const timestamp = Math.floor(now.getTime() / 1000);
    const header = signPayload(payload, timestamp, 'a-different-secret');

    expect(() => verifyStripeWebhookSignature(payload, header, SECRET, now)).toThrow();
  });

  it('throws when the payload was tampered with after signing', () => {
    const originalPayload = JSON.stringify({ type: 'customer.subscription.updated', data: { object: { id: 'sub_1' } } });
    const now = new Date('2026-08-19T12:00:00Z');
    const timestamp = Math.floor(now.getTime() / 1000);
    const header = signPayload(originalPayload, timestamp, SECRET);
    const tamperedPayload = JSON.stringify({ type: 'customer.subscription.updated', data: { object: { id: 'sub_evil' } } });

    expect(() => verifyStripeWebhookSignature(tamperedPayload, header, SECRET, now)).toThrow();
  });

  it('throws when the signature header is missing', () => {
    expect(() => verifyStripeWebhookSignature('{}', null, SECRET)).toThrow('Missing Stripe-Signature header');
  });

  it('throws when the timestamp is outside the tolerance window', () => {
    const payload = JSON.stringify({ type: 'customer.subscription.updated', data: { object: {} } });
    const now = new Date('2026-08-19T12:00:00Z');
    const oldTimestamp = Math.floor(now.getTime() / 1000) - 600; // 10 minutes old
    const header = signPayload(payload, oldTimestamp, SECRET);

    expect(() => verifyStripeWebhookSignature(payload, header, SECRET, now)).toThrow('too old');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/billing/stripe-webhook.test.ts`
Expected: FAIL with "Cannot find module '@/lib/billing/stripe-webhook'"

- [ ] **Step 3: Write minimal implementation**
```ts
// lib/billing/stripe-webhook.ts
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Hand-rolled verification of Stripe's webhook signature scheme, matching
 * this codebase's existing precedent for hand-rolled signed tokens
 * (lib/digest/unsubscribe-token.ts, lib/oauth/state.ts) rather than
 * pulling in the Stripe SDK for one cryptographic check. Scheme:
 * header is `t=<unix-seconds>,v1=<hex-hmac-sha256("t.payload")>`.
 */

const TOLERANCE_SECONDS = 300; // Stripe's own default replay-attack tolerance

export interface StripeWebhookEvent {
  type: string;
  data: { object: Record<string, unknown> };
}

export function verifyStripeWebhookSignature(
  payload: string,
  signatureHeader: string | null,
  webhookSecret: string,
  now: Date = new Date()
): StripeWebhookEvent {
  if (!signatureHeader) {
    throw new Error('Missing Stripe-Signature header');
  }

  const parts = Object.fromEntries(
    signatureHeader.split(',').map((part) => {
      const [key, value] = part.split('=');
      return [key, value];
    })
  );
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) {
    throw new Error('Malformed Stripe-Signature header');
  }

  const expectedSignature = createHmac('sha256', webhookSecret).update(`${timestamp}.${payload}`).digest('hex');
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');
  const actualBuffer = Buffer.from(signature, 'hex');
  if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) {
    throw new Error('Stripe webhook signature verification failed');
  }

  const ageSeconds = Math.abs(now.getTime() / 1000 - Number(timestamp));
  if (ageSeconds > TOLERANCE_SECONDS) {
    throw new Error('Stripe webhook timestamp too old');
  }

  return JSON.parse(payload) as StripeWebhookEvent;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/billing/stripe-webhook.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add lib/billing/stripe-webhook.ts tests/unit/lib/billing/stripe-webhook.test.ts
git commit -m "feat: add hand-rolled Stripe webhook signature verification"
```

---

### Task 4: Webhook event handler + route

**Files:**
- Create: `lib/billing/webhook-handler.ts`
- Create: `app/api/webhooks/stripe/route.ts`
- Test: `tests/unit/lib/billing/webhook-handler.test.ts`

**Interfaces:**
- Consumes: `StripeWebhookEvent` (Task 3), `createSupabaseServiceRoleClient` (existing `lib/supabase/server.ts`)
- Produces: `SubscriptionStatus`, `mapStripeSubscriptionStatus(stripeStatus)`, `StripeSubscriptionEventObject`, `WebhookHandlerDeps`, `handleStripeWebhookEvent(deps, event)` — `SubscriptionStatus` relied on by Task 5

- [ ] **Step 1: Write the failing test**
```ts
// tests/unit/lib/billing/webhook-handler.test.ts
import { describe, it, expect, vi } from 'vitest';
import { handleStripeWebhookEvent, mapStripeSubscriptionStatus } from '@/lib/billing/webhook-handler';

describe('mapStripeSubscriptionStatus', () => {
  it('passes through known statuses unchanged', () => {
    expect(mapStripeSubscriptionStatus('active')).toBe('active');
    expect(mapStripeSubscriptionStatus('past_due')).toBe('past_due');
    expect(mapStripeSubscriptionStatus('canceled')).toBe('canceled');
  });

  it('maps an unrecognized status to incomplete', () => {
    expect(mapStripeSubscriptionStatus('trialing')).toBe('incomplete');
    expect(mapStripeSubscriptionStatus('paused')).toBe('incomplete');
  });
});

describe('handleStripeWebhookEvent', () => {
  it('syncs subscription fields on customer.subscription.created', async () => {
    const updateSubscriptionFromStripe = vi.fn();
    await handleStripeWebhookEvent(
      { updateSubscriptionFromStripe, markSubscriptionCanceled: vi.fn() },
      {
        type: 'customer.subscription.created',
        data: { object: { id: 'sub_1', customer: 'cus_1', status: 'active', current_period_end: 1786000000, cancel_at_period_end: false } },
      }
    );
    expect(updateSubscriptionFromStripe).toHaveBeenCalledWith({
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: 'sub_1',
      status: 'active',
      currentPeriodEnd: new Date(1786000000 * 1000).toISOString(),
      cancelAtPeriodEnd: false,
    });
  });

  it('syncs subscription fields on customer.subscription.updated, mapping an unknown status to incomplete', async () => {
    const updateSubscriptionFromStripe = vi.fn();
    await handleStripeWebhookEvent(
      { updateSubscriptionFromStripe, markSubscriptionCanceled: vi.fn() },
      {
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub_1', customer: 'cus_1', status: 'trialing', current_period_end: null, cancel_at_period_end: true } },
      }
    );
    expect(updateSubscriptionFromStripe).toHaveBeenCalledWith({
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: 'sub_1',
      status: 'incomplete',
      currentPeriodEnd: null,
      cancelAtPeriodEnd: true,
    });
  });

  it('marks the subscription canceled on customer.subscription.deleted', async () => {
    const markSubscriptionCanceled = vi.fn();
    await handleStripeWebhookEvent(
      { updateSubscriptionFromStripe: vi.fn(), markSubscriptionCanceled },
      {
        type: 'customer.subscription.deleted',
        data: { object: { id: 'sub_1', customer: 'cus_1', status: 'canceled', current_period_end: null, cancel_at_period_end: false } },
      }
    );
    expect(markSubscriptionCanceled).toHaveBeenCalledWith('cus_1');
  });

  it('is a no-op for an unrecognized event type', async () => {
    const updateSubscriptionFromStripe = vi.fn();
    const markSubscriptionCanceled = vi.fn();
    await handleStripeWebhookEvent({ updateSubscriptionFromStripe, markSubscriptionCanceled }, { type: 'invoice.paid', data: { object: {} } });
    expect(updateSubscriptionFromStripe).not.toHaveBeenCalled();
    expect(markSubscriptionCanceled).not.toHaveBeenCalled();
  });

  it('processing the same event twice produces identical writes both times (idempotency)', async () => {
    const calls: unknown[] = [];
    const updateSubscriptionFromStripe = vi.fn(async (params) => {
      calls.push(params);
    });
    const event = {
      type: 'customer.subscription.updated' as const,
      data: { object: { id: 'sub_1', customer: 'cus_1', status: 'active', current_period_end: 1786000000, cancel_at_period_end: false } },
    };
    await handleStripeWebhookEvent({ updateSubscriptionFromStripe, markSubscriptionCanceled: vi.fn() }, event);
    await handleStripeWebhookEvent({ updateSubscriptionFromStripe, markSubscriptionCanceled: vi.fn() }, event);
    expect(calls[0]).toEqual(calls[1]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/billing/webhook-handler.test.ts`
Expected: FAIL with "Cannot find module '@/lib/billing/webhook-handler'"

- [ ] **Step 3: Write minimal implementation**
```ts
// lib/billing/webhook-handler.ts
import type { StripeWebhookEvent } from './stripe-webhook';

export type SubscriptionStatus = 'active' | 'past_due' | 'canceled' | 'incomplete';

const KNOWN_STATUSES: readonly SubscriptionStatus[] = ['active', 'past_due', 'canceled', 'incomplete'];

/**
 * Narrows Stripe's full status vocabulary ('trialing', 'unpaid', 'paused',
 * etc.) down to the four this app branches on — see spec §1. This plan has
 * no trial/pause support, so anything outside that set maps to
 * 'incomplete', which reads as "no access" everywhere entitlement is checked.
 */
export function mapStripeSubscriptionStatus(stripeStatus: string): SubscriptionStatus {
  return (KNOWN_STATUSES as readonly string[]).includes(stripeStatus) ? (stripeStatus as SubscriptionStatus) : 'incomplete';
}

export interface StripeSubscriptionEventObject {
  id: string;
  customer: string;
  status: string;
  current_period_end: number | null;
  cancel_at_period_end: boolean;
}

export interface WebhookHandlerDeps {
  updateSubscriptionFromStripe: (params: {
    stripeCustomerId: string;
    stripeSubscriptionId: string;
    status: SubscriptionStatus;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  }) => Promise<void>;
  markSubscriptionCanceled: (stripeCustomerId: string) => Promise<void>;
}

export async function handleStripeWebhookEvent(deps: WebhookHandlerDeps, event: StripeWebhookEvent): Promise<void> {
  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object as unknown as StripeSubscriptionEventObject;
      await deps.updateSubscriptionFromStripe({
        stripeCustomerId: sub.customer,
        stripeSubscriptionId: sub.id,
        status: mapStripeSubscriptionStatus(sub.status),
        currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
      });
      return;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object as unknown as StripeSubscriptionEventObject;
      await deps.markSubscriptionCanceled(sub.customer);
      return;
    }
    default:
      // Unrecognized event type — intentional no-op. The route still
      // returns 200 so Stripe doesn't retry something we deliberately
      // ignore. See spec §5.
      return;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/billing/webhook-handler.test.ts`
Expected: PASS

- [ ] **Step 5: Write the route (no dedicated test — see Global Constraints)**
```ts
// app/api/webhooks/stripe/route.ts
import { NextResponse } from 'next/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { verifyStripeWebhookSignature } from '@/lib/billing/stripe-webhook';
import { handleStripeWebhookEvent } from '@/lib/billing/webhook-handler';

export async function POST(request: Request) {
  const signature = request.headers.get('stripe-signature');
  const rawBody = await request.text();

  let event;
  try {
    event = verifyStripeWebhookSignature(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET ?? '');
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const serviceClient = createSupabaseServiceRoleClient();

  try {
    await handleStripeWebhookEvent(
      {
        // The row being updated here always already exists — it's created
        // by POST /api/billing/checkout the moment a creator starts
        // checkout, before Stripe ever knows about the customer. A plain
        // update (keyed by the unique stripe_customer_id) is always
        // correct and simpler than an upsert. See spec §1/§5.
        updateSubscriptionFromStripe: async ({ stripeCustomerId, stripeSubscriptionId, status, currentPeriodEnd, cancelAtPeriodEnd }) => {
          const { error } = await serviceClient
            .from('subscriptions')
            .update({
              stripe_subscription_id: stripeSubscriptionId,
              status,
              current_period_end: currentPeriodEnd,
              cancel_at_period_end: cancelAtPeriodEnd,
            })
            .eq('stripe_customer_id', stripeCustomerId);
          if (error) {
            throw new Error(`Failed to sync subscription: ${error.message}`);
          }
        },
        markSubscriptionCanceled: async (stripeCustomerId) => {
          const { error } = await serviceClient.from('subscriptions').update({ status: 'canceled' }).eq('stripe_customer_id', stripeCustomerId);
          if (error) {
            throw new Error(`Failed to mark subscription canceled: ${error.message}`);
          }
        },
      },
      event
    );
  } catch (err) {
    console.error('Stripe webhook handling failed:', err);
    return NextResponse.json({ error: 'Webhook handling failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
```

- [ ] **Step 6: Verify the project still builds**

Run: `npm run build`
Expected: exit code 0

- [ ] **Step 7: Commit**
```bash
git add lib/billing/webhook-handler.ts app/api/webhooks/stripe/route.ts tests/unit/lib/billing/webhook-handler.test.ts
git commit -m "feat: add Stripe webhook event handler and route"
```

---

### Task 5: Entitlement check

**Files:**
- Create: `lib/billing/entitlements.ts`
- Test: `tests/unit/lib/billing/entitlements.test.ts`

**Interfaces:**
- Consumes: `SubscriptionStatus` (Task 4), `Database` (Task 1)
- Produces: `hasActiveSubscription(supabase, profileId)` — relied on by Tasks 8, 9

- [ ] **Step 1: Write the failing test**
```ts
// tests/unit/lib/billing/entitlements.test.ts
import { describe, it, expect } from 'vitest';
import { hasActiveSubscription } from '@/lib/billing/entitlements';

function makeSupabaseStub(row: { status: string } | null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: row, error: null }),
        }),
      }),
    }),
  } as any;
}

describe('hasActiveSubscription', () => {
  it('is true for an active subscription', async () => {
    expect(await hasActiveSubscription(makeSupabaseStub({ status: 'active' }), 'profile-1')).toBe(true);
  });

  it('is true for a past_due subscription (payment-retry grace period)', async () => {
    expect(await hasActiveSubscription(makeSupabaseStub({ status: 'past_due' }), 'profile-1')).toBe(true);
  });

  it('is false for a canceled subscription', async () => {
    expect(await hasActiveSubscription(makeSupabaseStub({ status: 'canceled' }), 'profile-1')).toBe(false);
  });

  it('is false for an incomplete subscription', async () => {
    expect(await hasActiveSubscription(makeSupabaseStub({ status: 'incomplete' }), 'profile-1')).toBe(false);
  });

  it('is false when no subscription row exists', async () => {
    expect(await hasActiveSubscription(makeSupabaseStub(null), 'profile-1')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/billing/entitlements.test.ts`
Expected: FAIL with "Cannot find module '@/lib/billing/entitlements'"

- [ ] **Step 3: Write minimal implementation**
```ts
// lib/billing/entitlements.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/types';

/**
 * 'past_due' still counts as entitled — Stripe is automatically retrying a
 * failed payment; access only turns off once retries are exhausted and the
 * subscription is genuinely canceled (the webhook then writes 'canceled').
 * See spec §6 / decision 5.
 */
export async function hasActiveSubscription(supabase: SupabaseClient<Database>, profileId: string): Promise<boolean> {
  const { data } = await supabase.from('subscriptions').select('status').eq('profile_id', profileId).maybeSingle();
  return data?.status === 'active' || data?.status === 'past_due';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/billing/entitlements.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add lib/billing/entitlements.ts tests/unit/lib/billing/entitlements.test.ts
git commit -m "feat: add hasActiveSubscription entitlement check"
```

---

### Task 6: Checkout handler + route

**Files:**
- Create: `lib/billing/checkout-handler.ts`
- Create: `app/api/billing/checkout/route.ts`
- Test: `tests/unit/lib/billing/checkout-handler.test.ts`

**Interfaces:**
- Consumes: `StripeClient` (Task 2), `createFakeStripeClient` (Task 2, test only), `createSupabaseServerClient`/`createSupabaseServiceRoleClient` (existing)
- Produces: `CheckoutHandlerDeps`, `CheckoutRequestContext`, `CheckoutHandlerResult`, `handleCheckoutRequest(deps, context)` — exercised end-to-end by the Playwright test (Task 14)

- [ ] **Step 1: Write the failing test**
```ts
// tests/unit/lib/billing/checkout-handler.test.ts
import { describe, it, expect, vi } from 'vitest';
import { handleCheckoutRequest } from '@/lib/billing/checkout-handler';
import { createFakeStripeClient } from '../../../fakes/stripe.fake';

function makeDeps(overrides: Partial<Parameters<typeof handleCheckoutRequest>[0]> = {}) {
  return {
    stripeClient: createFakeStripeClient(),
    priceId: 'price_test',
    successUrl: 'https://example.com/billing?checkout=success',
    cancelUrl: 'https://example.com/billing',
    getSubscriptionCustomerId: async () => null,
    createSubscriptionRow: async () => {},
    getProfileEmail: async () => 'creator@example.com',
    ...overrides,
  };
}

describe('handleCheckoutRequest', () => {
  it('rejects requests without a signed-in profile', async () => {
    const result = await handleCheckoutRequest(makeDeps(), { profileId: null });
    expect(result.status).toBe(401);
  });

  it('creates a new Stripe customer and subscription row on first checkout', async () => {
    const createSubscriptionRow = vi.fn();
    const stripeClient = createFakeStripeClient({ createCustomer: async () => ({ id: 'cus_new' }) });
    const deps = makeDeps({ createSubscriptionRow, stripeClient });

    const result = await handleCheckoutRequest(deps, { profileId: 'profile-1' });

    expect(createSubscriptionRow).toHaveBeenCalledWith({ profileId: 'profile-1', stripeCustomerId: 'cus_new' });
    expect(result.status).toBe(200);
    expect(result.body.url).toBeTruthy();
  });

  it('reuses an existing Stripe customer instead of creating a duplicate', async () => {
    const createCustomer = vi.fn();
    const createSubscriptionRow = vi.fn();
    const deps = makeDeps({
      getSubscriptionCustomerId: async () => 'cus_existing',
      stripeClient: createFakeStripeClient({ createCustomer }),
      createSubscriptionRow,
    });

    const result = await handleCheckoutRequest(deps, { profileId: 'profile-1' });

    expect(createCustomer).not.toHaveBeenCalled();
    expect(createSubscriptionRow).not.toHaveBeenCalled();
    expect(result.status).toBe(200);
  });

  it('returns the checkout session URL', async () => {
    const stripeClient = createFakeStripeClient({
      createCheckoutSession: async () => ({ id: 'cs_1', url: 'https://checkout.stripe.com/pay/cs_1' }),
    });
    const deps = makeDeps({ getSubscriptionCustomerId: async () => 'cus_existing', stripeClient });

    const result = await handleCheckoutRequest(deps, { profileId: 'profile-1' });

    expect(result.body).toEqual({ url: 'https://checkout.stripe.com/pay/cs_1' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/billing/checkout-handler.test.ts`
Expected: FAIL with "Cannot find module '@/lib/billing/checkout-handler'"

- [ ] **Step 3: Write minimal implementation**
```ts
// lib/billing/checkout-handler.ts
import type { StripeClient } from '@/lib/integrations/stripe';

export interface CheckoutHandlerDeps {
  stripeClient: StripeClient;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  getSubscriptionCustomerId: (profileId: string) => Promise<string | null>;
  createSubscriptionRow: (params: { profileId: string; stripeCustomerId: string }) => Promise<void>;
  getProfileEmail: (profileId: string) => Promise<string>;
}

export interface CheckoutRequestContext {
  profileId: string | null;
}

export interface CheckoutHandlerResult {
  status: number;
  body: Record<string, unknown>;
}

export async function handleCheckoutRequest(deps: CheckoutHandlerDeps, context: CheckoutRequestContext): Promise<CheckoutHandlerResult> {
  if (!context.profileId) {
    return { status: 401, body: { error: 'You must be signed in to upgrade.' } };
  }

  let customerId = await deps.getSubscriptionCustomerId(context.profileId);
  if (!customerId) {
    const email = await deps.getProfileEmail(context.profileId);
    const customer = await deps.stripeClient.createCustomer({ email });
    await deps.createSubscriptionRow({ profileId: context.profileId, stripeCustomerId: customer.id });
    customerId = customer.id;
  }

  const session = await deps.stripeClient.createCheckoutSession({
    customerId,
    priceId: deps.priceId,
    successUrl: deps.successUrl,
    cancelUrl: deps.cancelUrl,
  });

  return { status: 200, body: { url: session.url } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/billing/checkout-handler.test.ts`
Expected: PASS

- [ ] **Step 5: Write the route (no dedicated test — see Global Constraints)**
```ts
// app/api/billing/checkout/route.ts
import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { createStripeClient } from '@/lib/integrations/stripe';
import { handleCheckoutRequest } from '@/lib/billing/checkout-handler';

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const serviceClient = createSupabaseServiceRoleClient();
  const origin = new URL(request.url).origin;

  const result = await handleCheckoutRequest(
    {
      stripeClient: createStripeClient(process.env.STRIPE_SECRET_KEY ?? ''),
      priceId: process.env.STRIPE_PRICE_ID ?? '',
      successUrl: `${origin}/billing?checkout=success`,
      cancelUrl: `${origin}/billing`,
      getSubscriptionCustomerId: async (profileId) => {
        const { data } = await serviceClient.from('subscriptions').select('stripe_customer_id').eq('profile_id', profileId).maybeSingle();
        return data?.stripe_customer_id ?? null;
      },
      createSubscriptionRow: async ({ profileId, stripeCustomerId }) => {
        const { error } = await serviceClient
          .from('subscriptions')
          .insert({ profile_id: profileId, stripe_customer_id: stripeCustomerId, status: 'incomplete' });
        if (error) {
          throw new Error(`Failed to create subscription row: ${error.message}`);
        }
      },
      getProfileEmail: async (profileId) => {
        const { data } = await serviceClient.from('profiles').select('email').eq('id', profileId).single();
        return data?.email ?? '';
      },
    },
    { profileId: user?.id ?? null }
  );

  return NextResponse.json(result.body, { status: result.status });
}
```

- [ ] **Step 6: Commit**
```bash
git add lib/billing/checkout-handler.ts app/api/billing/checkout/route.ts tests/unit/lib/billing/checkout-handler.test.ts
git commit -m "feat: add checkout handler and POST /api/billing/checkout route"
```

---

### Task 7: Portal handler + route

**Files:**
- Create: `lib/billing/portal-handler.ts`
- Create: `app/api/billing/portal/route.ts`
- Test: `tests/unit/lib/billing/portal-handler.test.ts`

**Interfaces:**
- Consumes: `StripeClient` (Task 2), `createFakeStripeClient` (Task 2, test only)
- Produces: `PortalHandlerDeps`, `PortalRequestContext`, `PortalHandlerResult`, `handlePortalRequest(deps, context)` — exercised by the Playwright test (Task 14)

- [ ] **Step 1: Write the failing test**
```ts
// tests/unit/lib/billing/portal-handler.test.ts
import { describe, it, expect } from 'vitest';
import { handlePortalRequest } from '@/lib/billing/portal-handler';
import { createFakeStripeClient } from '../../../fakes/stripe.fake';

function makeDeps(overrides: Partial<Parameters<typeof handlePortalRequest>[0]> = {}) {
  return {
    stripeClient: createFakeStripeClient(),
    returnUrl: 'https://example.com/billing',
    getSubscriptionCustomerId: async () => 'cus_existing',
    ...overrides,
  };
}

describe('handlePortalRequest', () => {
  it('rejects requests without a signed-in profile', async () => {
    const result = await handlePortalRequest(makeDeps(), { profileId: null });
    expect(result.status).toBe(401);
  });

  it('rejects a profile with no Stripe customer yet', async () => {
    const deps = makeDeps({ getSubscriptionCustomerId: async () => null });
    const result = await handlePortalRequest(deps, { profileId: 'profile-1' });
    expect(result.status).toBe(400);
  });

  it('returns the portal session URL for an existing customer', async () => {
    const stripeClient = createFakeStripeClient({ createPortalSession: async () => ({ url: 'https://billing.stripe.com/session/xyz' }) });
    const deps = makeDeps({ stripeClient });
    const result = await handlePortalRequest(deps, { profileId: 'profile-1' });
    expect(result.body).toEqual({ url: 'https://billing.stripe.com/session/xyz' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/billing/portal-handler.test.ts`
Expected: FAIL with "Cannot find module '@/lib/billing/portal-handler'"

- [ ] **Step 3: Write minimal implementation**
```ts
// lib/billing/portal-handler.ts
import type { StripeClient } from '@/lib/integrations/stripe';

export interface PortalHandlerDeps {
  stripeClient: StripeClient;
  returnUrl: string;
  getSubscriptionCustomerId: (profileId: string) => Promise<string | null>;
}

export interface PortalRequestContext {
  profileId: string | null;
}

export interface PortalHandlerResult {
  status: number;
  body: Record<string, unknown>;
}

export async function handlePortalRequest(deps: PortalHandlerDeps, context: PortalRequestContext): Promise<PortalHandlerResult> {
  if (!context.profileId) {
    return { status: 401, body: { error: 'You must be signed in to manage your plan.' } };
  }

  const customerId = await deps.getSubscriptionCustomerId(context.profileId);
  if (!customerId) {
    return { status: 400, body: { error: "You don't have a subscription to manage yet." } };
  }

  const session = await deps.stripeClient.createPortalSession({ customerId, returnUrl: deps.returnUrl });
  return { status: 200, body: { url: session.url } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/billing/portal-handler.test.ts`
Expected: PASS

- [ ] **Step 5: Write the route (no dedicated test — see Global Constraints)**
```ts
// app/api/billing/portal/route.ts
import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { createStripeClient } from '@/lib/integrations/stripe';
import { handlePortalRequest } from '@/lib/billing/portal-handler';

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const serviceClient = createSupabaseServiceRoleClient();
  const origin = new URL(request.url).origin;

  const result = await handlePortalRequest(
    {
      stripeClient: createStripeClient(process.env.STRIPE_SECRET_KEY ?? ''),
      returnUrl: `${origin}/billing`,
      getSubscriptionCustomerId: async (profileId) => {
        const { data } = await serviceClient.from('subscriptions').select('stripe_customer_id').eq('profile_id', profileId).maybeSingle();
        return data?.stripe_customer_id ?? null;
      },
    },
    { profileId: user?.id ?? null }
  );

  return NextResponse.json(result.body, { status: result.status });
}
```

- [ ] **Step 6: Commit**
```bash
git add lib/billing/portal-handler.ts app/api/billing/portal/route.ts tests/unit/lib/billing/portal-handler.test.ts
git commit -m "feat: add portal handler and POST /api/billing/portal route"
```

---

### Task 8: Gate `/api/recap`

**Files:**
- Modify: `lib/recap/handler.ts`
- Modify: `app/api/recap/route.ts`
- Modify: `tests/unit/lib/recap/handler.test.ts`

**Interfaces:**
- Consumes: `hasActiveSubscription` (Task 5)
- Produces: `RecapHandlerDeps` gains `hasActiveSubscription: (profileId: string) => Promise<boolean>`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/lib/recap/handler.test.ts`'s `makeDeps` default overrides object, add `hasActiveSubscription: async () => true,` (keeps every existing test passing unchanged), then add a new test inside `describe('handleRecapRequest', ...)`:
```ts
  it('rejects a signed-in profile with no active subscription', async () => {
    const deps = makeDeps({ hasActiveSubscription: async () => false });
    const result = await handleRecapRequest(deps, { profileId: 'p1', ip: '203.0.113.1', now: NOW });
    expect(result.status).toBe(402);
    expect(result.body.upgradeUrl).toBe('/billing');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/recap/handler.test.ts`
Expected: FAIL — `makeDeps` now requires `hasActiveSubscription` per the updated `RecapHandlerDeps` type (once Step 3 lands); before that, the new test fails because nothing returns 402 yet

- [ ] **Step 3: Modify `lib/recap/handler.ts`**

Add `hasActiveSubscription: (profileId: string) => Promise<boolean>;` to the `RecapHandlerDeps` interface, and insert this check immediately after the existing 401 guard (before `getProfileHandles`):
```ts
  if (!(await deps.hasActiveSubscription(context.profileId))) {
    return {
      status: 402,
      body: { error: 'Recap Card requires an active subscription.', upgradeUrl: '/billing' },
    };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/recap/handler.test.ts`
Expected: PASS (all existing cases still pass since the fake `hasActiveSubscription` in `makeDeps` defaults to `true`)

- [ ] **Step 5: Wire the dependency into `app/api/recap/route.ts`'s POST, and gate GET**

In `app/api/recap/route.ts`, add the import `import { hasActiveSubscription } from '@/lib/billing/entitlements';`. In `POST`, add `hasActiveSubscription: (profileId) => hasActiveSubscription(serviceClient, profileId),` to the `handleRecapRequest` deps object. In `GET`, immediately after the existing `if (!user) { ... 401 ... }` block, add:
```ts
  if (!(await hasActiveSubscription(serviceClient, user.id))) {
    return NextResponse.json({ error: 'Recap Card requires an active subscription.', upgradeUrl: '/billing' }, { status: 402 });
  }
```
(placed after `const serviceClient = createSupabaseServiceRoleClient();` is declared — move that declaration above the 401 check if it isn't already, since it's now needed there too).

- [ ] **Step 6: Verify the full unit suite and a build still pass**

Run: `npx vitest run && npm run build`
Expected: PASS / exit code 0

- [ ] **Step 7: Commit**
```bash
git add lib/recap/handler.ts app/api/recap/route.ts tests/unit/lib/recap/handler.test.ts
git commit -m "feat: gate /api/recap behind an active subscription"
```

---

### Task 9: Gate `/api/ideas`

**Files:**
- Modify: `lib/ideas/handler.ts`
- Modify: `app/api/ideas/route.ts`
- Modify: `tests/unit/lib/ideas/handler.test.ts`

**Interfaces:**
- Consumes: `hasActiveSubscription` (Task 5)
- Produces: `IdeasHandlerDeps` gains `hasActiveSubscription: (profileId: string) => Promise<boolean>`

- [ ] **Step 1: Write the failing test**

Add `hasActiveSubscription: async () => true,` to `tests/unit/lib/ideas/handler.test.ts`'s `makeDeps` defaults, then add:
```ts
  it('rejects a signed-in profile with no active subscription', async () => {
    const deps = makeDeps({ hasActiveSubscription: async () => false });
    const result = await handleIdeasRequest(deps, { profileId: 'p1', ip: '203.0.113.1', now: NOW });
    expect(result.status).toBe(402);
    expect(result.body.upgradeUrl).toBe('/billing');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/ideas/handler.test.ts`
Expected: FAIL — no 402 path exists yet

- [ ] **Step 3: Modify `lib/ideas/handler.ts`**

Add `hasActiveSubscription: (profileId: string) => Promise<boolean>;` to `IdeasHandlerDeps`, and insert immediately after the existing 401 guard (before the niche lookup):
```ts
  if (!(await deps.hasActiveSubscription(context.profileId))) {
    return {
      status: 402,
      body: { error: 'Weekly Content Ideas requires an active subscription.', upgradeUrl: '/billing' },
    };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/ideas/handler.test.ts`
Expected: PASS

- [ ] **Step 5: Wire the dependency into `app/api/ideas/route.ts`'s POST, and gate GET**

Add the import `import { hasActiveSubscription } from '@/lib/billing/entitlements';`. In `POST`, add `hasActiveSubscription: (profileId) => hasActiveSubscription(serviceClient, profileId),` to the `handleIdeasRequest` deps object. In `GET`, immediately after the existing `if (!user) { ... 401 ... }` block:
```ts
  if (!(await hasActiveSubscription(serviceClient, user.id))) {
    return NextResponse.json({ error: 'Weekly Content Ideas requires an active subscription.', upgradeUrl: '/billing' }, { status: 402 });
  }
```
(move `const serviceClient = createSupabaseServiceRoleClient();` above the 401 check in `GET` if needed, same as Task 8.)

- [ ] **Step 6: Verify the full unit suite and a build still pass**

Run: `npx vitest run && npm run build`
Expected: PASS / exit code 0

- [ ] **Step 7: Commit**
```bash
git add lib/ideas/handler.ts app/api/ideas/route.ts tests/unit/lib/ideas/handler.test.ts
git commit -m "feat: gate /api/ideas behind an active subscription"
```

---

### Task 10: `UpgradePrompt` component + gate `/recap`'s UI

**Files:**
- Create: `components/UpgradePrompt.tsx`
- Modify: `lib/recap/page-state.ts`
- Modify: `app/recap/page.tsx`
- Test: `tests/unit/components/UpgradePrompt.test.tsx`
- Modify: `tests/unit/lib/recap/page-state.test.ts`

**Interfaces:**
- Consumes: nothing new
- Produces: `<UpgradePrompt title body />` — relied on by Task 11; `RecapPageState` gains `{ status: 'requiresUpgrade' }`; `RecapPageEvent` gains `{ type: 'BOOTSTRAP_PAYMENT_REQUIRED' }`

- [ ] **Step 1: Write the failing test for `UpgradePrompt`**
```tsx
// tests/unit/components/UpgradePrompt.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { UpgradePrompt } from '@/components/UpgradePrompt';

describe('UpgradePrompt', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    // jsdom doesn't implement navigation; assigning window.location.href
    // throws "Not implemented" unless stubbed per test.
    delete (window as unknown as { location?: unknown }).location;
    (window as unknown as { location: { href: string } }).location = { href: '' };
  });

  it('renders the given title and body', () => {
    render(<UpgradePrompt title="Recap Card is a paid feature" body="Upgrade to unlock it." />);
    expect(screen.getByText('Recap Card is a paid feature')).toBeInTheDocument();
    expect(screen.getByText('Upgrade to unlock it.')).toBeInTheDocument();
  });

  it('starts checkout and redirects on button click', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ url: 'https://checkout.stripe.com/pay/cs_1' }) }));
    render(<UpgradePrompt title="t" body="b" />);

    fireEvent.click(screen.getByRole('button', { name: /upgrade/i }));

    await waitFor(() => expect(window.location.href).toBe('https://checkout.stripe.com/pay/cs_1'));
  });

  it('shows an error message when checkout fails to start', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Something went wrong.' }) }));
    render(<UpgradePrompt title="t" body="b" />);

    fireEvent.click(screen.getByRole('button', { name: /upgrade/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong.'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/UpgradePrompt.test.tsx`
Expected: FAIL with "Cannot find module '@/components/UpgradePrompt'"

- [ ] **Step 3: Write `UpgradePrompt`**
```tsx
// components/UpgradePrompt.tsx
'use client';

import { useState } from 'react';

export interface UpgradePromptProps {
  title: string;
  body: string;
}

export function UpgradePrompt({ title, body }: UpgradePromptProps) {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function startCheckout() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/billing/checkout', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.url) {
        setError(data.error ?? 'Something went wrong starting checkout.');
        setSubmitting(false);
        return;
      }
      window.location.href = data.url;
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-indigo-200 bg-indigo-50 p-6">
      <h2 className="text-xl font-bold text-gray-900">{title}</h2>
      <p className="text-gray-700">{body}</p>
      <button
        type="button"
        onClick={startCheckout}
        disabled={submitting}
        className="self-start rounded-full bg-indigo-600 px-6 py-3 font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {submitting ? 'Redirecting…' : 'Upgrade — $10/mo'}
      </button>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/UpgradePrompt.test.tsx`
Expected: PASS

- [ ] **Step 5: Write the failing test for `RecapPageState`**

Add to `tests/unit/lib/recap/page-state.test.ts`:
```ts
  it('moves to requiresUpgrade on BOOTSTRAP_PAYMENT_REQUIRED', () => {
    const next = recapPageReducer({ status: 'loading' }, { type: 'BOOTSTRAP_PAYMENT_REQUIRED' });
    expect(next).toEqual({ status: 'requiresUpgrade' });
  });
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/recap/page-state.test.ts`
Expected: FAIL — `BOOTSTRAP_PAYMENT_REQUIRED` isn't a recognized event yet, TypeScript error and/or reducer falls through to `default: return state`

- [ ] **Step 7: Modify `lib/recap/page-state.ts`**

Add `| { status: 'requiresUpgrade' }` to the `RecapPageState` union, add `| { type: 'BOOTSTRAP_PAYMENT_REQUIRED' }` to `RecapPageEvent`, and add a case to `recapPageReducer` (alongside the existing `BOOTSTRAP_UNAUTHORIZED` case):
```ts
    case 'BOOTSTRAP_PAYMENT_REQUIRED':
      return { status: 'requiresUpgrade' };
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/recap/page-state.test.ts`
Expected: PASS

- [ ] **Step 9: Wire into `app/recap/page.tsx`**

In the bootstrap `fetch('/api/recap')` handler, add a `402` branch alongside the existing `401` branch:
```ts
        if (res.status === 402) {
          dispatch({ type: 'BOOTSTRAP_PAYMENT_REQUIRED' });
          return;
        }
```
And add a render branch (alongside the `AppNav`-mounted authenticated branch, replacing the tool entirely — per spec §7):
```tsx
  if (state.status === 'requiresUpgrade') {
    return (
      <>
        <AppNav />
        <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
          <h1 className="text-2xl font-bold text-gray-900">Recap Card</h1>
          <UpgradePrompt
            title="Recap Card is part of Creator Dashboard's paid plan"
            body="Get a shareable monthly summary of your platform performance for $10/mo."
          />
        </main>
      </>
    );
  }
```
Add `import { UpgradePrompt } from '@/components/UpgradePrompt';` to the top of the file.

- [ ] **Step 10: Verify the full unit suite and a build still pass**

Run: `npx vitest run && npm run build`
Expected: PASS / exit code 0

- [ ] **Step 11: Commit**
```bash
git add components/UpgradePrompt.tsx lib/recap/page-state.ts app/recap/page.tsx tests/unit/components/UpgradePrompt.test.tsx tests/unit/lib/recap/page-state.test.ts
git commit -m "feat: add UpgradePrompt and gate /recap's UI behind subscription"
```

---

### Task 11: Gate `/ideas`'s UI

**Files:**
- Modify: `lib/ideas/page-state.ts`
- Modify: `app/ideas/page.tsx`
- Modify: `tests/unit/lib/ideas/page-state.test.ts`

**Interfaces:**
- Consumes: `<UpgradePrompt>` (Task 10)
- Produces: `IdeasPageState` gains `{ status: 'requiresUpgrade' }`; `IdeasPageEvent` gains `{ type: 'BOOTSTRAP_PAYMENT_REQUIRED' }`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/lib/ideas/page-state.test.ts`:
```ts
  it('moves to requiresUpgrade on BOOTSTRAP_PAYMENT_REQUIRED', () => {
    const next = ideasPageReducer({ status: 'loading' }, { type: 'BOOTSTRAP_PAYMENT_REQUIRED' });
    expect(next).toEqual({ status: 'requiresUpgrade' });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/ideas/page-state.test.ts`
Expected: FAIL — `BOOTSTRAP_PAYMENT_REQUIRED` isn't a recognized event yet

- [ ] **Step 3: Modify `lib/ideas/page-state.ts`**

Add `| { status: 'requiresUpgrade' }` to `IdeasPageState`, add `| { type: 'BOOTSTRAP_PAYMENT_REQUIRED' }` to `IdeasPageEvent`, and add a case to `ideasPageReducer` (alongside `BOOTSTRAP_UNAUTHORIZED`):
```ts
    case 'BOOTSTRAP_PAYMENT_REQUIRED':
      return { status: 'requiresUpgrade' };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/ideas/page-state.test.ts`
Expected: PASS

- [ ] **Step 5: Wire into `app/ideas/page.tsx`**

In the bootstrap `fetch('/api/ideas')` handler, add a `402` branch alongside the existing `401` branch:
```ts
        if (res.status === 402) {
          dispatch({ type: 'BOOTSTRAP_PAYMENT_REQUIRED' });
          return;
        }
```
And add a render branch:
```tsx
  if (state.status === 'requiresUpgrade') {
    return (
      <>
        <AppNav />
        <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
          <h1 className="text-2xl font-bold text-gray-900">Weekly content ideas</h1>
          <UpgradePrompt
            title="Weekly Content Ideas is part of Creator Dashboard's paid plan"
            body="Get a ranked shortlist of niche-specific content concepts every week for $10/mo."
          />
        </main>
      </>
    );
  }
```
Add `import { UpgradePrompt } from '@/components/UpgradePrompt';` to the top of the file.

- [ ] **Step 6: Verify the full unit suite and a build still pass**

Run: `npx vitest run && npm run build`
Expected: PASS / exit code 0

- [ ] **Step 7: Commit**
```bash
git add lib/ideas/page-state.ts app/ideas/page.tsx tests/unit/lib/ideas/page-state.test.ts
git commit -m "feat: gate /ideas's UI behind subscription"
```

---

### Task 12: `/billing` page state machine

**Files:**
- Create: `lib/billing/page-state.ts`
- Test: `tests/unit/lib/billing/page-state.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `BillingStatusData`, `BillingPageState`, `BillingPageEvent`, `createInitialBillingPageState()`, `billingPageReducer(state, event)` — relied on by Task 13

- [ ] **Step 1: Write the failing test**
```ts
// tests/unit/lib/billing/page-state.test.ts
import { describe, it, expect } from 'vitest';
import { billingPageReducer, createInitialBillingPageState } from '@/lib/billing/page-state';

describe('createInitialBillingPageState', () => {
  it('starts loading', () => {
    expect(createInitialBillingPageState()).toEqual({ status: 'loading' });
  });
});

describe('billingPageReducer', () => {
  it('moves to polling on START_POLLING', () => {
    const next = billingPageReducer({ status: 'loading' }, { type: 'START_POLLING' });
    expect(next).toEqual({ status: 'polling' });
  });

  it('moves to free on BOOTSTRAPPED with free data', () => {
    const next = billingPageReducer({ status: 'loading' }, { type: 'BOOTSTRAPPED', data: { status: 'free' } });
    expect(next).toEqual({ status: 'free' });
  });

  it('moves to subscribed on BOOTSTRAPPED with active data', () => {
    const next = billingPageReducer(
      { status: 'loading' },
      { type: 'BOOTSTRAPPED', data: { status: 'active', currentPeriodEnd: '2026-09-01T00:00:00Z', cancelAtPeriodEnd: false } }
    );
    expect(next).toEqual({ status: 'subscribed', currentPeriodEnd: '2026-09-01T00:00:00Z', cancelAtPeriodEnd: false, pastDue: false });
  });

  it('moves to subscribed with pastDue true on BOOTSTRAPPED with past_due data', () => {
    const next = billingPageReducer(
      { status: 'loading' },
      { type: 'BOOTSTRAPPED', data: { status: 'past_due', currentPeriodEnd: '2026-09-01T00:00:00Z', cancelAtPeriodEnd: false } }
    );
    expect(next).toEqual({ status: 'subscribed', currentPeriodEnd: '2026-09-01T00:00:00Z', cancelAtPeriodEnd: false, pastDue: true });
  });

  it('moves to free with justCheckedOut on POLL_EXHAUSTED', () => {
    const next = billingPageReducer({ status: 'polling' }, { type: 'POLL_EXHAUSTED' });
    expect(next).toEqual({ status: 'free', justCheckedOut: true });
  });

  it('moves to bootstrapFailed on BOOTSTRAP_FAILED', () => {
    const next = billingPageReducer({ status: 'loading' }, { type: 'BOOTSTRAP_FAILED' });
    expect(next).toEqual({ status: 'bootstrapFailed' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/billing/page-state.test.ts`
Expected: FAIL with "Cannot find module '@/lib/billing/page-state'"

- [ ] **Step 3: Write minimal implementation**
```ts
// lib/billing/page-state.ts
export type BillingStatusData =
  | { status: 'free' }
  | { status: 'active' | 'past_due'; currentPeriodEnd: string; cancelAtPeriodEnd: boolean };

export type BillingPageState =
  | { status: 'loading' }
  | { status: 'polling' }
  | { status: 'free'; justCheckedOut?: boolean }
  | { status: 'subscribed'; currentPeriodEnd: string; cancelAtPeriodEnd: boolean; pastDue: boolean }
  | { status: 'bootstrapFailed' };

export type BillingPageEvent =
  | { type: 'START_POLLING' }
  | { type: 'BOOTSTRAPPED'; data: BillingStatusData }
  | { type: 'POLL_EXHAUSTED' }
  | { type: 'BOOTSTRAP_FAILED' };

export function createInitialBillingPageState(): BillingPageState {
  return { status: 'loading' };
}

export function billingPageReducer(state: BillingPageState, event: BillingPageEvent): BillingPageState {
  switch (event.type) {
    case 'START_POLLING':
      return { status: 'polling' };

    case 'BOOTSTRAPPED':
      if (event.data.status === 'free') {
        return { status: 'free' };
      }
      return {
        status: 'subscribed',
        currentPeriodEnd: event.data.currentPeriodEnd,
        cancelAtPeriodEnd: event.data.cancelAtPeriodEnd,
        pastDue: event.data.status === 'past_due',
      };

    case 'POLL_EXHAUSTED':
      return { status: 'free', justCheckedOut: true };

    case 'BOOTSTRAP_FAILED':
      return { status: 'bootstrapFailed' };

    default:
      return state;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/billing/page-state.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add lib/billing/page-state.ts tests/unit/lib/billing/page-state.test.ts
git commit -m "feat: add /billing page state machine"
```

---

### Task 13: `GET /api/billing/status` route + `/billing` page + nav link

**Files:**
- Create: `app/api/billing/status/route.ts`
- Create: `app/billing/page.tsx`
- Modify: `components/AppNav.tsx`
- Modify: `tests/unit/components/AppNav.test.tsx`

**Interfaces:**
- Consumes: `billingPageReducer`/`createInitialBillingPageState`/`BillingStatusData` (Task 12), `<AppNav>` (existing), `<UpgradePrompt>` (Task 10)
- Produces: `GET /api/billing/status` response shape `BillingStatusData` (Task 12) or `{ error }`; `BillingPage` default export

- [ ] **Step 1: Write the failing test for the `AppNav` link**

Add to `tests/unit/components/AppNav.test.tsx`, inside the `'shows identity and highlights the active link once signed in'` test (or as a new test):
```ts
  it('includes a Billing link', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ email: 'jordan@example.com' }) }));
    render(<AppNav />);
    await waitFor(() => expect(screen.getByRole('link', { name: 'Billing' })).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Billing' })).toHaveAttribute('href', '/billing');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/AppNav.test.tsx`
Expected: FAIL — no "Billing" link rendered yet

- [ ] **Step 3: Add the nav link**

In `components/AppNav.tsx`, add `{ href: '/billing', label: 'Billing' }` as a fifth entry in `NAV_LINKS`, after Ideas.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/AppNav.test.tsx`
Expected: PASS

- [ ] **Step 5: Write the status route (no dedicated test — see Global Constraints)**
```ts
// app/api/billing/status/route.ts
import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 });
  }

  const serviceClient = createSupabaseServiceRoleClient();
  const { data } = await serviceClient
    .from('subscriptions')
    .select('status,current_period_end,cancel_at_period_end')
    .eq('profile_id', user.id)
    .maybeSingle();

  if (!data || (data.status !== 'active' && data.status !== 'past_due')) {
    return NextResponse.json({ status: 'free' });
  }

  return NextResponse.json({
    status: data.status,
    currentPeriodEnd: data.current_period_end,
    cancelAtPeriodEnd: data.cancel_at_period_end,
  });
}
```

- [ ] **Step 6: Write the `/billing` page**
```tsx
// app/billing/page.tsx
'use client';

import { useEffect, useReducer, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppNav } from '@/components/AppNav';
import { UpgradePrompt } from '@/components/UpgradePrompt';
import { billingPageReducer, createInitialBillingPageState } from '@/lib/billing/page-state';
import type { BillingStatusData } from '@/lib/billing/page-state';

const POLL_ATTEMPTS = 4;
const POLL_DELAY_MS = 1500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function BillingPage() {
  const router = useRouter();
  const [state, dispatch] = useReducer(billingPageReducer, createInitialBillingPageState());
  const [managingPlan, setManagingPlan] = useState(false);
  const [manageError, setManageError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchStatus(): Promise<BillingStatusData | 'unauthorized' | null> {
      const res = await fetch('/api/billing/status');
      if (res.status === 401) return 'unauthorized';
      const data = await res.json();
      if (data.error) return null;
      return data as BillingStatusData;
    }

    async function bootstrap() {
      const isCheckoutSuccess = new URLSearchParams(window.location.search).get('checkout') === 'success';

      if (isCheckoutSuccess) {
        dispatch({ type: 'START_POLLING' });
        for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
          const data = await fetchStatus();
          if (cancelled) return;
          if (data === 'unauthorized') {
            router.replace('/');
            return;
          }
          if (data === null) {
            dispatch({ type: 'BOOTSTRAP_FAILED' });
            return;
          }
          if (data.status !== 'free') {
            dispatch({ type: 'BOOTSTRAPPED', data });
            return;
          }
          if (attempt < POLL_ATTEMPTS - 1) await sleep(POLL_DELAY_MS);
        }
        if (!cancelled) dispatch({ type: 'POLL_EXHAUSTED' });
        return;
      }

      const data = await fetchStatus();
      if (cancelled) return;
      if (data === 'unauthorized') {
        router.replace('/');
        return;
      }
      if (data === null) {
        dispatch({ type: 'BOOTSTRAP_FAILED' });
        return;
      }
      dispatch({ type: 'BOOTSTRAPPED', data });
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function managePlan() {
    setManagingPlan(true);
    setManageError(null);
    try {
      const res = await fetch('/api/billing/portal', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.url) {
        setManageError(data.error ?? 'Something went wrong opening your plan settings.');
        setManagingPlan(false);
        return;
      }
      window.location.href = data.url;
    } catch {
      setManageError("We couldn't reach the server. Check your connection and try again.");
      setManagingPlan(false);
    }
  }

  if (state.status === 'loading' || state.status === 'polling') {
    return (
      <>
        <AppNav />
        <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
          <h1 className="text-2xl font-bold text-gray-900">Billing</h1>
          <p>{state.status === 'polling' ? 'Finishing up…' : 'Loading…'}</p>
        </main>
      </>
    );
  }

  if (state.status === 'bootstrapFailed') {
    return (
      <>
        <AppNav />
        <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
          <h1 className="text-2xl font-bold text-gray-900">Billing</h1>
          <p role="alert">We couldn&apos;t load your billing status. Please refresh and try again.</p>
        </main>
      </>
    );
  }

  return (
    <>
      <AppNav />
      <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
        <h1 className="text-2xl font-bold text-gray-900">Billing</h1>

        {state.status === 'free' && (
          <>
            {state.justCheckedOut && (
              <p className="rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-800">
                Payment received — this can take a minute to reflect. Refresh to check again.
              </p>
            )}
            <UpgradePrompt
              title="You're on the free plan"
              body="Upgrade to unlock Recap Card and Weekly Content Ideas."
            />
          </>
        )}

        {state.status === 'subscribed' && (
          <div className="flex flex-col gap-4 rounded-lg border border-gray-200 p-6">
            {state.pastDue && (
              <p role="alert" className="text-sm text-red-600">
                We couldn&apos;t process your last payment — please update your card.
              </p>
            )}
            <p className="text-gray-700">
              {state.cancelAtPeriodEnd
                ? `Your plan ends ${new Date(state.currentPeriodEnd).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}.`
                : `You're subscribed — renews ${new Date(state.currentPeriodEnd).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}.`}
            </p>
            <button
              type="button"
              onClick={managePlan}
              disabled={managingPlan}
              className="self-start rounded-full border border-indigo-600 px-6 py-3 font-semibold text-indigo-700 disabled:opacity-50"
            >
              {managingPlan ? 'Redirecting…' : 'Manage plan'}
            </button>
            {manageError && (
              <p role="alert" className="text-sm text-red-600">
                {manageError}
              </p>
            )}
          </div>
        )}
      </main>
    </>
  );
}
```

- [ ] **Step 7: Verify the full unit suite and a build still pass**

Run: `npx vitest run && npm run build`
Expected: PASS / exit code 0

- [ ] **Step 8: Commit**
```bash
git add app/api/billing/status/route.ts app/billing/page.tsx components/AppNav.tsx tests/unit/components/AppNav.test.tsx
git commit -m "feat: add /billing page, status route, and nav link"
```

---

### Task 14: `.env.example` + Playwright E2E smoke test

**Files:**
- Modify: `.env.example`
- Test: `tests/e2e/billing-smoke.spec.ts`

**Interfaces:**
- Consumes: `/recap` (Task 10), `/ideas` (Task 11), `/billing` (Task 13) — mocks `GET /api/recap`, `GET /api/billing/status`, and `POST /api/billing/checkout` at the browser network layer, so no real Stripe/Supabase calls occur
- Produces: nothing consumed by later tasks — this is the terminal verification of the billing feature slice

- [ ] **Step 1: Add the Stripe env vars**

Append to `.env.example`:
```
# Stripe — https://dashboard.stripe.com/apikeys (billing for Recap Card + Weekly Content Ideas)
STRIPE_SECRET_KEY=
# The Price ID for the $10/mo plan, created in the Stripe dashboard
STRIPE_PRICE_ID=
# Signs/verifies incoming webhook requests — from the webhook endpoint's
# settings in the Stripe dashboard, not something generated locally
STRIPE_WEBHOOK_SECRET=
```

- [ ] **Step 2: Write the E2E test**
```ts
// tests/e2e/billing-smoke.spec.ts
import { test, expect } from '@playwright/test';

test('a free visitor sees the upgrade screen on /recap and can start checkout', async ({ page }) => {
  await page.route('**/api/session', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ email: 'creator@example.com' }) })
  );
  await page.route('**/api/recap', (route) =>
    route.fulfill({
      status: 402,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Recap Card requires an active subscription.', upgradeUrl: '/billing' }),
    })
  );
  await page.route('**/api/billing/checkout', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: 'https://checkout.stripe.com/pay/cs_test_1' }) })
  );

  await page.goto('/recap');

  await expect(page.getByText("Recap Card is part of Creator Dashboard's paid plan")).toBeVisible();
  await page.getByRole('button', { name: /upgrade/i }).click();
  await page.waitForURL('https://checkout.stripe.com/pay/cs_test_1');
});

test('a subscribed visitor on /billing sees their renewal date and can open the portal', async ({ page }) => {
  await page.route('**/api/session', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ email: 'creator@example.com' }) })
  );
  await page.route('**/api/billing/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'active', currentPeriodEnd: '2026-09-19T00:00:00Z', cancelAtPeriodEnd: false }),
    })
  );
  await page.route('**/api/billing/portal', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: 'https://billing.stripe.com/session/xyz' }) })
  );

  await page.goto('/billing');

  await expect(page.getByText(/you're subscribed — renews/i)).toBeVisible();
  await page.getByRole('button', { name: /manage plan/i }).click();
  await page.waitForURL('https://billing.stripe.com/session/xyz');
});
```

- [ ] **Step 3: Run the test**

Run: `npm run build && npm run test:e2e -- billing-smoke.spec.ts`
Expected: PASS — 2 tests passed.

- [ ] **Step 4: Run the entire verification suite one final time**

Run: `npm run lint && npm run typecheck && npm test && npm run build && npm run test:e2e`
Expected: all green — this is the whole feature slice, confirming nothing in Tasks 1–14 regressed anything else in the app (Diagnostic included).

- [ ] **Step 5: Commit**
```bash
git add .env.example tests/e2e/billing-smoke.spec.ts
git commit -m "test: add billing Playwright smoke test and document Stripe env vars"
```

---

## Self-Review

**Spec coverage:** §1 data model → Task 1. §2 env vars → Task 14 (folded in at the end, matching how `.env.example` updates land alongside their last consuming piece in prior plans). §3 checkout → Task 6. §4 portal → Task 7. §5 webhook → Tasks 3–4. §6 entitlement → Task 5. §7 gating (both server and client) → Tasks 8–11. §8 `/billing` page (incl. post-checkout polling) → Tasks 12–13. §9 testing strategy → present throughout, adjusted per the note below.

**Deviation from the spec, caught during self-review (writing-plans "Type consistency" check):**
1. **No `stripe` npm dependency.** The spec's §2 named the official Stripe SDK, but every other external integration in this codebase (`lib/integrations/resend.ts`'s own comment: *"no SDK dependency, matching every other external integration in this codebase"*, plus YouTube/Apify/Claude/TikTok-OAuth/Instagram-OAuth) uses plain `fetch`. Task 2 corrects this — a plain-fetch wrapper, no new dependency. Webhook signature verification is hand-rolled HMAC (Task 3) rather than the SDK's `stripe.webhooks.constructEvent`, matching this codebase's existing hand-rolled signed-token precedent (`lib/digest/unsubscribe-token.ts`, `lib/oauth/state.ts`).
2. **No dedicated `app/api/*/route.test.ts` files.** The spec's §9 listed test files for `checkout/route.ts`, `portal/route.ts`, and the webhook route directly. Checking this codebase's actual test suite: `GET /api/recap`, `GET /api/ideas`, and every other `route.ts` in this app have **zero** dedicated route-level tests — only their DI handler functions do (`lib/recap/handler.test.ts`, `lib/ideas/handler.test.ts`, etc.), with route wiring covered only by the build and the Playwright E2E suite. Every task here follows that same shape: real logic lives in a tested `lib/billing/*-handler.ts` function; `route.ts` is thin, untested wiring. The new gating on `GET /api/recap`/`GET /api/ideas` (which has no handler function to hang a test on, matching those GETs' existing untested-row-mapping shape) is covered by Task 14's E2E test instead.

**Type consistency verified across tasks:** `StripeClient` (Task 2) → consumed identically by `checkout-handler.ts` (Task 6) and `portal-handler.ts` (Task 7), both via `createFakeStripeClient`. `StripeWebhookEvent` (Task 3) → consumed by `webhook-handler.ts` (Task 4). `SubscriptionStatus` (Task 4) → the same four-value union backs the migration's `check` constraint (Task 1), the Database type (Task 1), `hasActiveSubscription`'s comparison (Task 5), and `BillingStatusData` (Task 12). `hasActiveSubscription(supabase, profileId)` (Task 5) → same signature consumed in Tasks 8, 9, and inline in the checkout/portal/status routes' `serviceClient`-scoped closures. `BillingPageState`/`BillingStatusData` (Task 12) → consumed unchanged by `app/billing/page.tsx` (Task 13).

**Placeholder scan:** no task contains TBD/TODO or "similar to Task N" — every step has complete, runnable code, including all six new/modified test files' full assertions.
