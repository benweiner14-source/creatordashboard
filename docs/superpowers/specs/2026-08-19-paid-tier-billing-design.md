# Paid Tier / Billing Design Spec

**Date:** 2026-08-19
**Classification:** Architectural (per `brainstorming`) — a new external integration (Stripe), a new table, three new routes, a new page, and gating logic added to two existing features. No existing data model changes beyond one new table.
**Status:** Approved for planning pending user review of this doc.

## What this is

Today every tool in the app is free, gated only by abuse-guard rate limits (see `PRODUCT.md`: "No billing or paid tier exists yet — everything is currently free"). This spec introduces a single $10/mo paid plan and puts **Recap Card** and **Weekly Content Ideas** behind it, matching the original product brief's intent that only the Diagnostic ("paste your link") tool was ever meant to be free. Diagnostic is unaffected by this spec — it stays free, under its existing 1-per-30-days rate limit.

Billing is handled entirely through Stripe's hosted surfaces (Checkout for payment, Customer Portal for plan management) — this app never collects, sees, or stores a card number. Our own database only ever tracks the *result* of what Stripe reports, synced via webhook.

## Decisions already made (inputs to this spec)

From the `brainstorming` round (confirmed via `AskUserQuestion` / direct answers):

1. **Free tier = Diagnostic only.** Recap Card and Weekly Content Ideas — both fully built and currently free — become paid-only. This is a real behavior change for those two tools' existing (currently unauthenticated-by-payment) access, not a new empty feature being added behind a wall.
2. **Single flat plan: $10/mo, no trial.** No tiers, no annual option, no introductory discount.
3. **Stripe Checkout + Customer Portal (hosted), webhook-synced local state** — not embedded Stripe Elements, not live Stripe API calls on the gated request path. Matches this codebase's existing local-first pattern (rate-limit-store, `platform_connections`, `weekly_digests` are all local state kept in sync with an external system via events/tokens, never queried live on every request).
4. **Dedicated `/billing` page**, added as a fifth link in `<AppNav>`, showing plan status and the relevant action button (Upgrade, or Manage plan).
5. **Grace period on payment failure**: access stays active through Stripe's automatic retry window; only downgrades to free once Stripe's retries are exhausted and the subscription is genuinely canceled — not on the first failed charge.
6. **Cancellation keeps access through the paid period** — standard "access until period end" behavior, not an instant cutoff.

## Non-goals

- No multiple plans/tiers — one plan, one price.
- No proration, coupons, or promo codes.
- No usage-based billing or metering — a subscription is binary (active or not), it doesn't gate *how many* recaps/digests a paying creator can generate beyond the existing daily abuse-guard limits, which are unchanged by this spec.
- No in-app payment form of any kind — 100% Stripe-hosted for both checkout and plan management.
- No team/multi-seat billing — one subscription per profile, enforced by a `unique` constraint.
- No migration concern for existing paying users, because there are none yet (pre-launch, per `PRODUCT.md`).
- No changes to Diagnostic's free-tier behavior or rate limit.

---

## 1. Data model

New table, `subscriptions` — one row per profile once they've ever started checkout (mirrors the "own table per concern" pattern already used by `platform_connections` and `weekly_digests`, rather than adding billing columns to `profiles`):

```sql
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
-- webhook handler and checkout/portal routes ever write to this table.
```

- `profile_id unique` — one subscription per creator; a second checkout attempt reuses the existing row rather than creating a second one (see §3).
- `stripe_customer_id` is created (via Stripe's API) and stored the moment someone *starts* checkout, before payment completes — so a retried or abandoned checkout doesn't create duplicate Stripe customers for the same profile.
- `stripe_subscription_id` is nullable because the customer can exist (they clicked "Upgrade") before a subscription exists (they haven't finished paying yet).
- `status` mirrors a deliberately narrowed subset of Stripe's own subscription statuses — only the four that matter for gating (`active`, `past_due`, `canceled`, `incomplete`). Any other Stripe status (`trialing`, `unpaid`, `paused`) is out of scope since this plan has no trial and we're not building pause support.
- Entitlement is `status === 'active' || status === 'past_due'` (§6) — `past_due` still counts as "has access," per decision 5's grace period.

`lib/supabase/types.ts`'s hand-written `Database` type gains a `subscriptions` table entry matching this shape (`Row`/`Insert`/`Update`), same convention as every other table.

---

## 2. Stripe account setup & environment variables

This spec assumes a Stripe account and one Product/Price ($10/mo recurring) are created directly in the Stripe dashboard (not provisioned by code — same "we write files that target external services via env vars, we don't provision the external service" boundary this whole project has followed since the original scaffold plan). New `.env.example` entries:

```
# Stripe — https://dashboard.stripe.com/apikeys (billing for Recap Card + Weekly Content Ideas)
STRIPE_SECRET_KEY=
# The Price ID for the $10/mo plan, created in the Stripe dashboard
STRIPE_PRICE_ID=
# Signs/verifies incoming webhook requests — from the webhook endpoint's
# settings in the Stripe dashboard, not something we generate ourselves
STRIPE_WEBHOOK_SECRET=
```

No new npm dependency. A new `lib/integrations/stripe.ts` wraps Stripe's REST API via plain `fetch`, matching `lib/integrations/resend.ts`'s explicit "no SDK dependency" convention (and every other integration in this codebase — YouTube, Apify, Claude, TikTok/Instagram OAuth): a thin `createStripeClient(secretKey)` returning a small typed interface (`createCustomer`, `createCheckoutSession`, `createPortalSession`), so route code and tests both depend on that interface rather than a third-party SDK.

---

## 3. `POST /api/billing/checkout`

New route. Auth required (401 pattern, matching every other authenticated route). Steps:

1. Look up (or create) the caller's `subscriptions` row:
   - If none exists: create a Stripe customer (`stripe.customers.create({ email })`), insert a `subscriptions` row with `status: 'incomplete'` and the new `stripe_customer_id`.
   - If one exists: reuse its `stripe_customer_id` (handles "clicked Upgrade, abandoned, came back").
2. Create a Stripe Checkout Session (`stripe.checkout.sessions.create`) for that customer, `mode: 'subscription'`, `line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }]`, `success_url`/`cancel_url` both pointing back to `/billing` (with a `?checkout=success` query flag on success, read by the page's polling state — see §8).
3. Return `{ url: session.url }`; the client does `window.location.href = url`.

The actual "you're now active" transition happens exclusively via webhook (§5), never inline in this route — Checkout Session creation succeeding only means the payment page was reachable, not that payment happened.

---

## 4. `POST /api/billing/portal`

New route. Auth required. Looks up the caller's `subscriptions.stripe_customer_id` (400 if none exists — you can't manage a plan you never started). Creates a Stripe Billing Portal session (`stripe.billingPortal.sessions.create`) for that customer, `return_url` pointing back to `/billing`. Returns `{ url: session.url }`, same client-side redirect pattern as §3.

---

## 5. `POST /api/webhooks/stripe` — the sync point

New route, unauthenticated in the normal sense (no signed-in user — Stripe is the caller) but verified via signature, the same shape as the cron route's `CRON_SECRET` check (§ precedent: `app/api/cron/weekly-digest/route.ts`) — using real HMAC-SHA256 verification of Stripe's signature scheme, hand-rolled in `lib/billing/stripe-webhook.ts` rather than via the Stripe SDK, matching this codebase's existing hand-rolled signed-token precedent (`lib/digest/unsubscribe-token.ts`, `lib/oauth/state.ts`) and the "no SDK" decision in §2:

```ts
const signature = request.headers.get('stripe-signature');
const rawBody = await request.text(); // signature verification needs the raw, unparsed body
const event = verifyStripeWebhookSignature(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET!);
// throws on an invalid/missing/expired signature — caught and returns 400
```

Uses `createSupabaseServiceRoleClient()` (bypasses RLS, same as the cron route and the diagnostic/recap/ideas generation handlers) since there's no signed-in user to scope the write to.

Handles three event types, all upserting the `subscriptions` row keyed by `stripe_customer_id`:

- `customer.subscription.created` / `customer.subscription.updated` — write `stripe_subscription_id`, `status` (mapped from Stripe's status — see §1's narrowed set; anything not in our four maps to `incomplete`), `current_period_end`, `cancel_at_period_end`.
- `customer.subscription.deleted` — sets `status: 'canceled'`. Fires when Stripe finally gives up after retries (decision 5) or when a canceled subscription's paid period actually ends.

Idempotency: every handler does an upsert keyed on `stripe_customer_id`, not an insert — Stripe can and does redeliver the same event more than once (documented behavior), so processing one twice must be a no-op, not a duplicate row or an error. No separate "processed events" log is needed because every write here is already naturally idempotent (same event → same final field values).

Returns `200` on success so Stripe stops retrying; returns `400` only for a signature that fails verification (a real forged/malformed request, not a business-logic failure — a recognized-but-unexpected event type is still a `200`, just a no-op, so Stripe doesn't retry something we intentionally ignore).

---

## 6. Entitlement check

New `lib/billing/entitlements.ts`:

```ts
export async function hasActiveSubscription(
  supabase: SupabaseClient<Database>,
  profileId: string
): Promise<boolean> {
  const { data } = await supabase
    .from('subscriptions')
    .select('status')
    .eq('profile_id', profileId)
    .maybeSingle();
  return data?.status === 'active' || data?.status === 'past_due';
}
```

Pure enough to unit-test directly against a fake Supabase client (same `tests/fakes/supabase-query-builder.fake.ts` pattern already used elsewhere), no DI wrapper needed since it's a single query with no branching worth abstracting behind an interface.

---

## 7. Gating `/recap` and `/ideas`

**Server-side (the enforcement that actually matters):** `GET /api/recap`, `POST /api/recap`, `GET /api/ideas`, `POST /api/ideas` each gain one check immediately after the existing 401 auth check: call `hasActiveSubscription`; if `false`, return `402 Payment Required` with `{ error: 'This feature requires an active subscription.', upgradeUrl: '/billing' }`. `402` is the semantically correct HTTP status for "you're authenticated, but you haven't paid" — distinct from `401` (not signed in) and `429` (rate-limited), both of which these routes already use for other cases.

**Client-side (the actual UX):** both pages' existing state machines (`RecapPageState`/`IdeasPageState` reducers) gain a new state, `{ status: 'requiresUpgrade' }`, reached when the bootstrap fetch returns `402`. Rendered as a dedicated upgrade screen: short explanation of what the feature does, a single "Upgrade — $10/mo" button that calls `POST /api/billing/checkout` and redirects to the returned URL. This replaces the tool entirely for a free visitor — no partial/preview access to Recap or Ideas.

This two-layer shape (page state machine for the UX, route-level check for the actual gate) matches this spec's own reasoning in the brainstorming discussion: the server check exists because the client one alone is bypassable by calling the route directly, not because the app doesn't trust its own UI.

---

## 8. `/billing` page

New route, `app/billing/page.tsx`, following the same `'use client'` + `useEffect` bootstrap pattern as every other authenticated page in this app (`/recap`, `/ideas`, `/home`). New `GET /api/billing/status` route returns the caller's subscription state (`{ status: 'free' } | { status: 'active' | 'past_due', currentPeriodEnd: string, cancelAtPeriodEnd: boolean }`, `401` if signed out).

Page states:
- `loading` → `<p>Loading…</p>`.
- `free` → "You're on the free plan." + Upgrade button → `POST /api/billing/checkout`.
- `active`, `cancelAtPeriodEnd: false` → "You're subscribed — renews {date}." + "Manage plan" button → `POST /api/billing/portal`.
- `active`/`past_due`, `cancelAtPeriodEnd: true` → "Your plan ends {date}." + "Manage plan" button (still routes to the portal, where they can resubscribe if they change their mind).
- `past_due` (not canceling) → "We couldn't process your last payment — please update your card." + "Manage plan" button, same portal destination. Access itself is unaffected (§6) — this is a heads-up, not a lockout.

**Post-checkout settling (decision-6-adjacent, from the edge-case discussion):** when the page loads with `?checkout=success` in the URL (set by §3's `success_url`), it polls `GET /api/billing/status` every 1.5s (up to 4 attempts, ~6s) showing a "Finishing up…" state until it sees `active`, instead of the ordinary single fetch — covers the brief window between Stripe redirecting the browser back and the webhook (§5) having landed. If it still isn't `active` after those attempts, falls back to the ordinary `free` state with a note: "Payment received — this can take a minute to reflect. Refresh to check again." (Doesn't claim failure; the webhook may simply be delayed, not lost.)

`components/AppNav.tsx`'s `NAV_LINKS` gains a fifth entry, `{ href: '/billing', label: 'Billing' }`, after Ideas.

---

## 9. Testing

Matching this app's established conventions — pure logic gets real unit tests, external calls get fakes, one Playwright smoke test per new user-facing flow:

- `tests/fakes/stripe.fake.ts` — a fake Stripe client covering `createCustomer`, `createCheckoutSession`, `createPortalSession`, following the same shape as `tests/fakes/claude.fake.ts`/`tests/fakes/scraper.fake.ts`.
- `lib/billing/stripe-webhook.test.ts` — real HMAC verification: a validly signed payload parses, a tampered payload/signature/wrong-secret throws, a missing header throws, a stale timestamp throws.
- `lib/billing/webhook-handler.test.ts` — the meaningful webhook test: `customer.subscription.created`/`updated`/`deleted` each call the right dep with the right mapped fields; an unrecognized event type is a no-op; processing the same event twice produces identical writes (idempotency, asserted directly).
- `lib/billing/entitlements.test.ts` — `hasActiveSubscription`: true for `active`/`past_due`, false for `canceled`/`incomplete`/no row.
- `lib/billing/checkout-handler.test.ts` — creates a new customer+row on first call; reuses the existing `stripe_customer_id` on a second call; 401 when signed out.
- `lib/billing/portal-handler.test.ts` — 400 when no subscription row exists; happy path returns a URL.
- `lib/recap/handler.test.ts` / `lib/ideas/handler.test.ts` — gain one new case each: signed in, no active subscription → 402 with the upgrade payload. Existing rate-limit/generation test cases are unaffected (they already run with the entitlement check mocked as active). **No dedicated `route.test.ts` files** for `checkout`/`portal`/`webhooks/stripe`/`recap`/`ideas` — checking this codebase's actual test suite, no `app/api/**/route.test.ts` exists anywhere today (`GET /api/recap`, `GET /api/ideas`, etc. are all untested at the route level); every route in this app is thin wiring around a tested handler function or, for trivial GETs, covered only by the build + E2E suite. This spec follows that same shape rather than introducing route-level testing that has no precedent here.
- `lib/recap/page-state.test.ts` / `lib/ideas/page-state.test.ts` — new `requiresUpgrade` transition on a `BOOTSTRAP_PAYMENT_REQUIRED` event (dispatched when bootstrap gets a 402).
- `lib/billing/page-state.test.ts` — the four+ reducer transitions (loading → polling/free/subscribed, poll-exhausted → free with a flag, bootstrap-failed).
- `components/UpgradePrompt.test.tsx` — renders given copy; starts checkout and redirects on click; shows an error on failure.
- `tests/e2e/billing-smoke.spec.ts` — mocked network: free visitor hits `/recap`, sees the upgrade screen, clicks through to a mocked checkout URL; separately, a subscribed visitor loads `/billing`, sees their renewal date, and opens the portal.

No live Stripe test-mode calls in CI (this app's existing convention — every integration test runs against a fake, matching how YouTube/Apify/Claude/Resend/OAuth are all tested today without real credentials).

---

## Self-review

**Scope check:** one new table, three new routes plus one status route, one new page, and a two-line addition (one `if` + one new state) to two existing state machines. No existing route's *existing* behavior changes — Recap/Ideas generation logic itself is untouched; only a new check gates entry to it.

**No fabricated data:** `/billing`'s displayed dates and status come directly from Stripe via the webhook-synced table; nothing is estimated or invented.

**Consistency with existing conventions confirmed by reading the actual code:** service-role client for webhook writes (matches the cron route and every generation handler), `402` chosen deliberately to stay distinct from this app's existing `401`/`429` usage, page bootstrap pattern matches `/recap`/`/ideas`/`/home` exactly, new table follows the RLS-policy and "own table per concern" shape of `platform_connections`/`weekly_digests`, fake-based testing matches every other external integration in this codebase.

**Consistency with the decisions made during brainstorming:** free/paid split (decision 1), plan structure (decision 2), Stripe-hosted-everything (decision 3), `/billing` page + nav link (decision 4), past-due grace period via `hasActiveSubscription` treating `past_due` as entitled (decision 5), cancellation access-until-period-end is Stripe's own native behavior for `cancel_at_period_end` and requires no extra logic on our side (decision 6).
