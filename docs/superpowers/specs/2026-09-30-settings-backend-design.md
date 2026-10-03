# Settings Backend Design Spec

**Date:** 2026-09-30
**Classification:** Architectural (per `brainstorming`) — five mostly-independent new subsystems (profile, platform connections, notifications, locale, two-factor auth, account deletion) sharing one host page. One combined spec by the product owner's explicit choice, covering all five at equal depth; each can still be built as its own implementation pass.
**Status:** Approved for planning. Reached conversationally with the product owner across this session, grounded in a live codebase audit (see "Decisions already made" for what that audit found) rather than assumed.

## What this is

`app/settings/page.tsx` (built in the prior session, PR #17) is an honest UI preview: a "Preview" banner discloses that most sections don't persist, and a couple of actions (password change, account deletion) plainly say they aren't available rather than faking success. This spec is the backend that makes those sections real — for the ones that make sense to build at all.

## Decisions already made (inputs to this spec, not open questions)

1. **One combined spec, not five separate ones.** The product owner explicitly chose this over decomposing into independent spec→plan→build cycles, understanding these are largely independent subsystems that happen to share a page.
2. **"Change password" is dropped entirely, not built.** A live codebase audit this session confirmed: sign-in is exclusively Supabase magic-link/OTP (`lib/auth/magic-link.ts`, `lib/auth/callback.ts`); zero code anywhere calls `signInWithPassword`, `signUp`, or `updateUser({ password })`. There is no password in this app to change. Removing the UI for it is a small follow-up to this spec's implementation, not a design question.
3. **Real two-factor authentication, via Supabase's native TOTP/MFA, layered on top of magic-link.** Confirmed Supabase's MFA system (`supabase.auth.mfa.*`) works independent of first-factor type — it doesn't require a password to exist. The magic link becomes factor 1; a TOTP code becomes factor 2. See §5.
4. **No multi-device session list.** The mockup's "iPhone — Safari, 2 days ago" style rows are fabricated demo content with no data source — Supabase doesn't expose self-service session-listing-with-device-metadata, and building it would mean a new session-tracking subsystem (recording device/IP per sign-in) that the product owner explicitly declined to scope now. The Sessions area keeps exactly what already works today: a single real "Sign out" button. No new "sign out everywhere" feature either (the product owner considered and declined it, having only asked for real 2FA from that pair of options).
5. **Connected platforms is a bug fix, not new infrastructure.** The audit found the OAuth authorize/callback/disconnect routes (`app/api/oauth/[platform]/*`) already have **no subscription gate at all** — only `GET /api/recap`, which happens to be the one existing place connection status is read, gates on `hasActiveSubscription`. That's why Settings' Connect/Disconnect buttons were left stubbed rather than wired to the real endpoints: doing so through `/api/recap` would have incorrectly blocked free users from managing their own connections on an unrelated page. The fix is a new, ungated read endpoint — seeing and reordering it is the entire scope of this piece.
6. **Notification triggers are scoped to what's real, not what's convenient to toggle.** Audited against the 5 UI toggles (see §6 table): one already has a real trigger (existing weekly-digest cron), one gets a genuinely new trigger as part of this spec (payment failure, wired into the existing Stripe webhook handler, a few lines since Resend is already integrated), and two have **no corresponding event to notify about** in this app's current synchronous architecture (recap cards and diagnostics are generated on-demand in the request the user is already watching, not background jobs) — those two toggles persist honestly but intentionally don't send anything yet.
7. **Timezone is functional, not decorative.** Persisted and actually used to format the dates currently hardcoded to `'en-US'`/UTC (Billing's renewal date, Home's recap month name). Language is persisted but doesn't translate any UI text — full i18n is explicitly out of scope, a separate project.
8. **Account deletion is soft-delete with a grace period**, chosen over immediate hard-delete or "no self-serve deletion" (both offered and declined). A pending Stripe subscription is canceled immediately on deletion request, not left to run during the grace period. Signing back in during the grace period auto-cancels the pending deletion.
9. **Email changes go through Supabase's own confirmation flow**, not an instant write — `supabase.auth.updateUser({ email })` emails the *new* address a confirmation link before the change takes effect. This is Supabase's built-in security behavior, not something to bypass, and it mirrors the "check your email" pattern the UI already uses for magic-link sign-in.

## Non-goals (explicitly deferred, do not fold into this build)

- Password-based sign-in as an option alongside magic-link (declined; see decision 2).
- Multi-device session listing/revocation and a "sign out everywhere" action (declined; see decision 4).
- Real notification sends for "Weekly recap ready" and "Diagnostic finished" — no async event exists to trigger them yet (see §6). Building that would mean making recap generation or diagnostic enrichment background jobs, a separate, much larger change to those features' own architecture, not a Settings change.
- Any UI translation / full i18n — locale is stored, not applied to copy (see §7).
- Data export (GDPR-style "download my data") — not requested, not scoped here.
- Changing how `profiles.email` is used elsewhere (it remains a client-writable, non-authoritative display field per the existing `20260815010000` migration's warning comment; this spec doesn't touch that hazard, just adds a real confirmation flow for the *auth* email via Supabase).

---

## 1. Shared conventions

Every new route in this spec follows the pattern already used by every existing route in `app/api/`:

- `const supabase = await createSupabaseServerClient(); const { data: { user } } = await supabase.auth.getUser();` → `401` if no user.
- Privileged reads/writes go through `createSupabaseServiceRoleClient()`, exactly as `/api/recap`, `/api/billing/*`, and the OAuth routes already do.
- No new validation library — this codebase hand-rolls validation (`isValidEmailFormat` in `lib/auth/sign-in-flow-state.ts` is the existing example); new routes do the same for their own inputs.
- New migrations are one timestamped file per feature area, following the existing `supabase/migrations/YYYYMMDDHHMMSS_description.sql` convention, each ending with the same owner-only RLS policy shape as `profiles`/`platform_connections`/`subscriptions`.
- Sensitive new actions reuse the existing `lib/rate-limit.ts` primitive (`checkAndRecordRateLimit`, profile-scoped) rather than a new one — used for account-deletion requests and MFA verification attempts (§5, §8).

## 2. Profile

**Migration:** none needed — `profiles.display_name` already exists (`20260812000001_create_profiles.sql`), unused until now.

**`PATCH /api/settings/profile`** — body `{ displayName: string }`. Validates `displayName.trim().length > 0 && displayName.length <= 60` (matching the UI's existing `maxLength={60}`), writes via service-role client, `400` on validation failure.

**Email** goes through Supabase Auth, not the `profiles` table:

**`POST /api/settings/email`** — body `{ email: string }`. Validates with the existing `isValidEmailFormat`, then calls `supabase.auth.updateUser({ email })` on the **user's own session client** (not service-role — this must be the authenticated user's own auth context, matching how `exchangeCodeForSession` and `signOut` already operate on the request-scoped `createSupabaseServerClient()`). Supabase sends a confirmation link to the new address; nothing changes until the user clicks it. Response: `{ status: 'confirmationSent' }`.

**Frontend:** `app/settings/page.tsx`'s Profile section calls `PATCH /api/settings/profile` on blur/save for display name (a "Saved" toast is now honest and can be added back), and `POST /api/settings/email` for the email field, swapping its current plain input-and-save for the same "check your email" pattern `SignInPrompt` already renders elsewhere in this app (reuse the copy pattern, not necessarily the component itself, since this isn't a sign-in flow).

## 3. Connected platforms

**No new table.** The fix is a new read endpoint that doesn't inherit `/api/recap`'s subscription gate:

**`GET /api/settings/platforms`** — mirrors the exact lightweight query `/api/recap/route.ts` already runs before its own gate, minus the gate:

```ts
const { data: connectionRows } = await serviceClient
  .from('platform_connections')
  .select('platform')
  .eq('profile_id', user.id);
const connected = new Set((connectionRows ?? []).map((row) => row.platform));

const { data: profile } = await serviceClient
  .from('profiles')
  .select('youtube_channel_handle')
  .eq('id', user.id)
  .single();

return NextResponse.json({
  tiktok: connected.has('tiktok'),
  instagram: connected.has('instagram'),
  youtube: Boolean(profile?.youtube_channel_handle),
});
```

Deliberately **not** `getPlatformConnection` (`lib/oauth/connections.ts`) — that function decrypts tokens and proactively refreshes them, real side effects with a real failure mode (a decrypt error, a revoked-refresh-token deletion) that a page just trying to render "Connected ✓" has no business triggering. A yes/no existence check needs none of that, exactly the reasoning `/api/recap` already applied by not calling it either for this same field.

**`PATCH /api/settings/platforms/youtube`** — body `{ handle: string | null }`. Writes `profiles.youtube_channel_handle` directly (same field Recap already reads/writes via `/api/recap/handles`), `null` to disconnect.

**Frontend:** Settings' Connect/Disconnect buttons for TikTok/Instagram become real links/calls to the existing `/api/oauth/[platform]/authorize` (a plain `<a href>`, exactly as Recap's page already does it) and `POST /api/oauth/[platform]/disconnect`. YouTube's row gets a small inline handle field instead of a connect button, calling the new PATCH route.

## 4. Timezone & locale

**Migration:**

```sql
alter table public.profiles
  add column timezone text not null default 'UTC',
  add column locale text not null default 'en-US';
```

**`PATCH /api/settings/locale`** — body `{ timezone?: string; locale?: string }`, either field optional so the two selects can save independently as the mockup's autosave-per-field behavior implies. Validate `timezone` against `Intl.supportedValuesOf('timeZone')` (built into Node/V8, no new dependency) and `locale` against a small fixed allowlist matching the UI's five `<option>`s — reject anything else with `400` rather than storing an arbitrary string that later formatting code has to defend against.

**Required frontend fix, not just a new call:** today's `<select>` in `app/settings/page.tsx` uses pretty-printed display strings as both the label and the `value` (e.g. `<option>(GMT-08:00) Pacific Time</option>`) — those aren't valid `Intl` timezone identifiers and can't be stored or fed to `formatDateInTimezone` below. The options need real IANA values with the existing text kept as the visible label, e.g. `<option value="America/Los_Angeles">(GMT-08:00) Pacific Time</option>`. Small change, but a real one this spec's implementation must make, not a pre-existing correct behavior to preserve.

**New shared helper, `lib/format/timezone.ts`:**

```ts
export function formatDateInTimezone(iso: string, timezone: string, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: timezone }).format(new Date(iso));
}
```

Replaces the hardcoded `toLocaleDateString('en-US', { month: 'long', day: 'numeric' })` calls in `app/billing/page.tsx` (renewal/ending date) and the hardcoded `timeZone: 'UTC'` in `app/home/page.tsx`'s recap month name — both call sites need the signed-in user's `profiles.timezone`, threaded through their existing bootstrap data (`BillingStatusData`/`HomeData` each gain a `timezone: string` field, populated server-side alongside their existing queries).

Language (`locale`) is stored and returned but not otherwise consumed anywhere yet — no UI text changes based on it (see Non-goals).

## 5. Two-factor authentication

Real TOTP via Supabase's native MFA, which layers on top of any first factor — no password required.

**No new table** — Supabase Auth stores enrolled factors itself (`auth.mfa_factors`, managed by Supabase, not app-owned).

**`POST /api/settings/mfa/enroll`** — calls `supabase.auth.mfa.enroll({ factorType: 'totp' })` on the user's own session client. Returns `{ factorId, qrCode, secret }` (Supabase returns a QR-code SVG/URI and the raw secret as a manual-entry fallback) straight through to the client — nothing is stored app-side.

**`POST /api/settings/mfa/verify`** — body `{ factorId: string; code: string }`. Rate-limited via `checkAndRecordRateLimit` (profile-scoped, e.g. 5 attempts / 10 minutes — a TOTP code is only 6 digits, brute-forceable without a limit). Calls `supabase.auth.mfa.challenge({ factorId })` then `supabase.auth.mfa.verify({ factorId, challengeId, code })`. Success activates the factor (Supabase's own state transition, `unverified` → `verified`); failure returns `400` with a generic "Incorrect code" message.

**`POST /api/settings/mfa/disable`** — body `{ factorId: string; code: string }`. Requires a **valid current code** before unenrolling (same challenge/verify pair as above, then `supabase.auth.mfa.unenroll({ factorId })`) — so a stolen session cookie alone can't turn off a victim's 2FA.

**Enforcement — the architectural core of this feature — lives in `lib/auth/callback.ts`.** Today, `handleAuthCallback` exchanges the magic-link code and redirects straight to `next` on success. This changes to:

```ts
export interface CallbackHandlerDeps {
  exchangeCodeForSession: (code: string) => Promise<{ error: { message: string } | null }>;
  hasVerifiedMfaFactor: () => Promise<boolean>; // supabase.auth.mfa.listFactors() on the just-created session
}
```

After a successful `exchangeCodeForSession`, call `hasVerifiedMfaFactor()`. If `true`, redirect to `/auth/mfa-challenge?next=<safeNext>` instead of `safeNext` directly — the session already exists at AAL1 (magic-link-verified) but the app treats the destination as gated until AAL2. `/auth/mfa-challenge` (new page) collects a 6-digit code and calls the same challenge/verify pair as `/api/settings/mfa/verify`, then redirects to `next` on success. If `false` (no 2FA enrolled), behavior is unchanged from today.

This means: a magic link alone signs in an account with 2FA off, exactly as today. An account with 2FA on requires the magic link *and* a TOTP code — real two-factor, with the "something you have" (email inbox) and "something you have" (authenticator app) pairing an app without passwords can actually offer.

**Frontend:** `app/settings/page.tsx`'s Security section replaces the local-only `Switch` with a real enroll flow (show QR + secret + a code-entry field on "turn on"; require a code to turn off), and `app/auth/mfa-challenge/page.tsx` is new.

## 6. Notifications & email

**Migration** — one new table replaces the two ad-hoc booleans on `profiles`:

```sql
create table public.notification_preferences (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  weekly_recap_ready boolean not null default true,
  new_content_ideas_ready boolean not null default true,
  diagnostic_finished boolean not null default true,
  product_marketing boolean not null default false,
  payment_billing_alerts boolean not null default true,
  updated_at timestamptz not null default now()
);
-- owner-only select policy, same shape as subscriptions; all writes via service-role.
```

A one-time backfill migration statement seeds a row per existing profile from the current `digest_email_opt_in` value into `new_content_ideas_ready` (the closest existing match — see table below), so nobody's existing weekly-digest subscription silently resets.

**`PATCH /api/settings/notifications`** — body is a partial map of the five keys to booleans; upserts the row.

**Reality check against the 5 toggles** (this is the section the product owner explicitly approved the split on):

| Toggle | Real trigger today? | This spec's scope |
|---|---|---|
| New content ideas ready | **Yes** — `app/api/cron/weekly-digest/route.ts` already runs weekly and emails opted-in profiles | Cron reads `notification_preferences.new_content_ideas_ready` instead of `profiles.digest_email_opt_in` (column kept for now, marked deprecated in a comment; dropped in a later migration once nothing reads it) |
| Payment & billing alerts | **New in this spec** — no email sent today, but the event (a subscription transitioning to `past_due`) is already detected | `lib/billing/webhook-handler.ts`'s `customer.subscription.updated` case gains: read the subscription's *current* stored status before overwriting it; if the new status is `'past_due'` and the old status wasn't, and `notification_preferences.payment_billing_alerts` is true for that profile, send one Resend email ("We couldn't process your last payment"). Guards against re-sending on every webhook redelivery of an already-past-due state. |
| Weekly recap ready | **No** — recap cards are generated synchronously, on-demand, in the request the user is already watching (`app/api/recap/route.ts`) | Toggle persists (honest, future-ready); **no send wired**, since there is no "ready" moment to notify about that the user isn't already looking at |
| Diagnostic finished | **No** — same reasoning; diagnostic + enrichment both complete within the request/response the user is watching | Toggle persists; no send wired |
| Product & marketing emails | N/A — a policy flag, not an event | Toggle persists; governs whether any *future* marketing send campaign is allowed to include this profile — no such campaign exists yet, so this is inert until one does, same honest framing as the two above |

**Frontend:** the five `Switch`es in `app/settings/page.tsx` call `PATCH /api/settings/notifications` per-toggle instead of local `useState`.

## 7. Account deletion

**Migration:**

```sql
alter table public.profiles
  add column scheduled_deletion_at timestamptz;
```

**New Stripe client method**, `lib/integrations/stripe.ts`:

```ts
export interface StripeClient {
  // ...existing methods...
  cancelSubscription(subscriptionId: string): Promise<void>;
}
```

Implemented as `DELETE https://api.stripe.com/v1/subscriptions/:id` (Stripe's immediate-cancellation endpoint — distinct from the existing checkout/portal flows, which only ever create sessions). The existing `stripeRequest` helper is `POST`-only internally; this needs a second small helper (or a `method` parameter added to it) for the `DELETE` verb.

**`POST /api/settings/delete-account`** — rate-limited via `checkAndRecordRateLimit` (profile-scoped; this is a destructive action, not a brute-forceable secret, but still worth a low ceiling like 3/day to blunt a compromised-session script). Flow:
1. Look up the profile's `subscriptions` row; if `status` is `'active'` or `'past_due'` and a `stripe_subscription_id` exists, call `stripeClient.cancelSubscription(id)` — the webhook's existing `customer.subscription.deleted` handler (`markSubscriptionCanceled`) then syncs the local row exactly as it already does for portal-initiated cancellations, no new sync path needed.
2. Write `profiles.scheduled_deletion_at = now() + interval '14 days'`.
3. Call `supabase.auth.signOut()` on the user's own session client (same call `/api/auth/sign-out` already makes).
4. Return `{ scheduledDeletionAt }`.

**Auto-cancel on return**: the bootstrap path every gated page already runs (`GET /api/session`, or the page's own bootstrap call) checks `profiles.scheduled_deletion_at`; if set and the user successfully re-authenticates, clear it and return a `justCancelledDeletion: true` flag so the client can show a one-time "Your account deletion was canceled" notice — chosen over a separate "cancel" button so a returning user doesn't have to find and click anything to save their account, matching the product owner's explicit preference for automatic cancellation on sign-in.

**New cron, `app/api/cron/delete-scheduled-accounts/route.ts`** — same `Bearer ${CRON_SECRET}` gate as the two existing crons (`warroom`, `weekly-digest`), runs daily. Selects every profile where `scheduled_deletion_at < now()`, and for each calls `serviceClient.auth.admin.deleteUser(profileId)`. The existing `ON DELETE CASCADE` chain (`profiles.id references auth.users(id) on delete cascade`, plus every feature table's own `profile_id` FK cascading from `profiles`) deletes everything else for free — diagnostics, recap cards, platform connections, subscriptions, notification preferences, all of it, with no per-table cleanup code needed in this cron.

**Frontend:** Settings' Danger Zone checks a `scheduledDeletionAt` field from bootstrap; if present, shows a countdown ("Your account will be deleted on \<date\>") instead of the confirm-flow UI, with no separate cancel button (per the auto-cancel-on-return design above — the only way to cancel is to keep using the account, which the user is already doing by virtue of seeing this screen). If absent, the existing two-step confirm UI now calls the real `POST /api/settings/delete-account` on final confirmation instead of showing "not available yet."

## 8. Error handling

- Every new route: `401` if signed out (standard), generic user-facing message + `console.error` server-side for unexpected failures, matching every existing route's convention.
- Profile display-name/locale/YouTube-handle validation failures: `400` with a specific field-level message (these are low-stakes, no reason to obscure why).
- Email change: Supabase's `updateUser` can itself fail (e.g. the new address is already in use by another account) — surface its error message directly, matching how `magic-link.ts` already passes through Supabase error messages for OTP failures.
- MFA verify/disable: always a generic "Incorrect code" on failure, never distinguishing "wrong code" from "expired challenge" to an attacker, and always rate-limited (§5).
- Account deletion: if `cancelSubscription` fails (Stripe API error), the whole deletion request fails with `500` rather than proceeding to schedule deletion with a still-active subscription that would keep billing during the grace period — this is the one place in this spec where a downstream failure must block the primary action rather than being logged and ignored.
- Notification preference PATCH: partial-failure isn't possible (single-row upsert), no special handling beyond the standard pattern.

## 9. Testing plan

- Unit: `lib/settings/profile-handler.test.ts`, `lib/settings/locale-handler.test.ts`, `lib/settings/platforms-handler.test.ts`, `lib/settings/notifications-handler.test.ts` — one handler-test file per area, following this codebase's injected-dependencies pattern (`billingPageReducer`-style deps objects), covering validation edge cases and the 401 path.
- Unit: `lib/billing/webhook-handler.test.ts` gains cases for the new past-due-transition email send (sends once on transition, not on redelivery of an already-past-due state, not sent for profiles with the toggle off).
- Unit: `lib/auth/callback.test.ts` gains cases for the new `hasVerifiedMfaFactor` branch (redirects to `/auth/mfa-challenge` when true, unchanged behavior when false).
- Unit: `lib/integrations/stripe.test.ts` gains a case for `cancelSubscription`'s request shape (`DELETE`, correct URL).
- Unit: `lib/settings/delete-account-handler.test.ts` — cancels an active subscription before scheduling, does NOT call Stripe when there's no active subscription, schedules 14 days out, signs out, blocks entirely (no scheduling) if `cancelSubscription` throws.
- Component: `tests/unit/app/settings/page.test.tsx` (already exists) gains cases per area — profile save, platform connect/disconnect against the new endpoints, notification toggles calling PATCH, MFA enroll/verify/disable flow, delete-account real confirm call and the scheduled-deletion countdown view.
- New: `tests/unit/app/auth/mfa-challenge/page.test.tsx` for the new challenge page.
- Migration test cases appended to `tests/unit/supabase/migrations.test.ts` for every new column/table in this spec (`profiles.timezone`/`locale`/`scheduled_deletion_at`, `notification_preferences`).
- `tests/fakes/` gains a fake for `supabase.auth.mfa.*` (enroll/challenge/verify/unenroll/listFactors) and extends the existing Stripe fake with `cancelSubscription`.
