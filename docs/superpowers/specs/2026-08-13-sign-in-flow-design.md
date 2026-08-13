# Sign-In Flow Design Spec

**Date:** 2026-08-13
**Classification:** Architectural (per `brainstorming`) — new subsystem (`lib/auth/`, `app/auth/`, a new client-side flow on `app/diagnostic/page.tsx`).
**Status:** Approved for planning. Decisions below were confirmed via `AskUserQuestion` earlier in this project; this doc turns them into an implementable design.

## Decisions already made (inputs to this spec, not open questions)

1. **Trigger point:** inline, at the point of friction — when an unauthenticated user submits the diagnostic form and the API returns 401. No dedicated `/sign-in` page.
2. **Round trip:** the pasted diagnostic URL survives the magic-link email round trip. After the user clicks the email link, they land back on `/diagnostic` with that URL restored in the field — but the app does **not** auto-submit it. The user clicks "Get my report" themselves. This is a deliberate agency decision: it's their one free diagnostic.
3. **Niche selection is out of scope** for this flow — it belongs to a later onboarding feature, not sign-in.
4. **Identity is magic-link only** (Supabase Auth, no password) — set as a Global Constraint in the original scaffold plan.

## Skills applied

- `state-machine` — models the flow below as explicit states/events/transitions to eliminate impossible combinations (e.g. "showing the check-your-email message" and "showing a magic-link error" at the same time).
- `form-design` — governs the new email field and a light touch-up of the existing URL field on the same page.
- `error-handling-ux` — governs the three distinct error surfaces this flow introduces.
- `loading-states` — governs the two async waits this flow adds (magic-link request, diagnostic submission) plus a gap found in the already-built report page.

## Non-goals

- No password auth, no OAuth providers, no account settings/profile page.
- No change to rate-limiting logic itself (that's the next item in the backlog, tracked separately).
- No niche/preferences capture.
- No retrofit of the report page's loading skeleton (flagged as a follow-up, tracked separately — unrelated file, not touched by this flow).

---

## 1. State machine

### States

| State | UI shown |
|---|---|
| `idle` | URL field, "Get my report" button. Nothing else. |
| `submittingDiagnostic` | Same form, disabled + spinner on the button. Escalating status text after 8s. |
| `needsSignIn` | Read-only summary of the pasted URL + "Not this link? Edit" affordance, plus the inline email field and its own submit button. |
| `submittingMagicLink` | Email field disabled, button shows a spinner. |
| `checkEmail` | Confirmation message naming the email address, with a "Resend" affordance. |
| `magicLinkError` | Same layout as `needsSignIn`, plus an inline error message under the email field. Email value preserved. |
| `diagnosticError` | Same layout as `idle`, plus an inline error message under the button. URL value preserved. |
| `redirectingToReport` | Transient — `router.push` fires immediately, no distinct UI. |

### Events

- `SUBMIT_DIAGNOSTIC` — guard: `isValidUrl(url)` (non-empty, parses as a URL). Real platform validation still happens server-side; this guard only prevents an obviously-empty submit.
- `DIAGNOSTIC_SUCCESS` — 200 from `POST /api/diagnostic`.
- `DIAGNOSTIC_UNAUTHORIZED` — 401 from `POST /api/diagnostic`.
- `DIAGNOSTIC_FAILED` — 400 / 429 / 500 from `POST /api/diagnostic`, or a network/fetch error.
- `EDIT_URL` — from `needsSignIn` or `magicLinkError`, discards the read-only summary and returns to `idle` with the URL still editable (no confirmation needed — nothing destructive, the value isn't cleared). This is `magicLinkError`'s escape route back to a clean slate; there is no separate retry event for that state.
- `SUBMIT_EMAIL` — guard: `isValidEmail(email)`, checked on blur, not on keystroke.
- `MAGIC_LINK_SENT` — 200 from `POST /api/auth/magic-link`.
- `MAGIC_LINK_FAILED` — non-200 from `POST /api/auth/magic-link`, or a network/fetch error.
- `RESEND_EMAIL` — from `checkEmail`, re-fires `SUBMIT_EMAIL` with the same address.
- `RETRY_EMAIL` — from `checkEmail`, returns to `needsSignIn` (notice cleared, email preserved), so a mistyped-but-valid address (e.g. `creator@gmial.com` — passes format validation and Supabase, but isn't what the user meant to type) can be corrected instead of only ever resent as-is.

Note: `magicLinkError` does not have its own `RETRY_EMAIL` transition — it would be redundant with `EDIT_URL`, which already gets you from `magicLinkError` back to a fully editable state. Similarly, `diagnosticError` has no dedicated retry event (a prior `RETRY_DIAGNOSTIC` event was removed as dead code) — it already supports direct edit-and-resubmit via `URL_CHANGED`/`SUBMIT_DIAGNOSTIC`, both of which work from that state.

### Transitions

```
idle              --SUBMIT_DIAGNOSTIC-->        submittingDiagnostic
submittingDiagnostic --DIAGNOSTIC_SUCCESS-->     redirectingToReport
submittingDiagnostic --DIAGNOSTIC_UNAUTHORIZED--> needsSignIn
submittingDiagnostic --DIAGNOSTIC_FAILED-->      diagnosticError

needsSignIn       --SUBMIT_EMAIL-->             submittingMagicLink
needsSignIn       --EDIT_URL-->                 idle
submittingMagicLink --MAGIC_LINK_SENT-->        checkEmail
submittingMagicLink --MAGIC_LINK_FAILED-->      magicLinkError
magicLinkError     --EDIT_URL-->                idle

checkEmail        --RESEND_EMAIL-->             submittingMagicLink
checkEmail        --RETRY_EMAIL-->              needsSignIn
diagnosticError    --URL_CHANGED-->             diagnosticError
diagnosticError    --SUBMIT_DIAGNOSTIC-->       submittingDiagnostic
```

Every state has a way out (no dead ends): `magicLinkError` and `diagnosticError` both loop back to a retryable state rather than a terminal one.

### Impossible states this eliminates

- `needsSignIn` + `magicLinkError` shown simultaneously as independent booleans — collapsed into one `magicLinkError` state so the email-error message can never render underneath the plain sign-in form at the same time.
- `submittingDiagnostic` + `diagnosticError` — a naive `{submitting, error}` boolean pair could theoretically show a spinner and an error together for one tick; the enum makes that unrepresentable.
- "Check your email" and a magic-link error message can't render together — they're mutually exclusive states, not two independently-toggled flags.

### Entry/exit actions

- **`idle` (on entry):** nothing cleared unless arriving via `EDIT_URL` from `needsSignIn`/`magicLinkError` (error cleared, url kept), directly from `diagnosticError` via `URL_CHANGED`/`SUBMIT_DIAGNOSTIC` (no distinct retry event — see the events-list note above), or on mount from a successful auth-callback round trip (url populated from the `?url=` query param, field left editable, no auto-submit).
- **`submittingDiagnostic` (on entry):** disable the button, show a small spinner + "Analyzing…". After 8 seconds elapsed (a `setTimeout`, cleared on exit), swap the text to "Still working — checking your video's stats and putting the report together…" per `loading-states`' "1–10s: clear loading state" / "over 10s: detailed progress" guidance — this call chain (YouTube/scraper fetch + Claude generation) realistically runs 5–15s.
- **`needsSignIn` (on entry):** preserve the pasted URL exactly as submitted; render it as a read-only summary line ("Checking: `<url>`") rather than a second editable copy, to avoid two sources of truth for the same value. Focus moves to the new email field.
- **`submittingMagicLink` (on entry):** disable the email field and button, show a spinner (this call is fast — Supabase OTP request — no escalating-message tier needed).
- **`checkEmail` (on entry):** replace the form with a confirmation message naming the address; keep a "Resend" text-button (styled as a secondary action, not a repeat of the primary CTA).
- **`magicLinkError` (on entry):** email value preserved in the field (never cleared on error, per `error-handling-ux`), error message rendered directly below the email field.
- **`diagnosticError` (on entry):** url value preserved, error message rendered directly below the button.
- **`redirectingToReport` (on entry):** `router.push('/diagnostic/' + id)` fires immediately; this state has no meaningful render window.

---

## 2. The auth callback round trip

`app/auth/callback/route.ts` is a `GET` handler Supabase's magic-link email points at. Design:

- When requesting the magic link, the app calls `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo } })` where `emailRedirectTo` = `${origin}/auth/callback?next=${encodeURIComponent('/diagnostic?url=' + encodeURIComponent(pastedUrl))}`.
- The callback route reads `next` from its own request URL **independent of whether code exchange succeeds** — this is what lets the pasted URL survive an *expired or invalid* link, not just a valid one.
- **On successful code exchange:** redirect to `next` verbatim (i.e. `/diagnostic?url=<encoded>`). The diagnostic page's `idle` state on mount reads `?url=` and pre-fills the field — not auto-submitted.
- **On failed/expired code exchange:** extract just the `url` value out of `next` (regex/URLSearchParams on the decoded string) and redirect to `/diagnostic?url=<encoded>&authError=expired`. On mount, the diagnostic page sees `authError=expired` + `url` present and enters `needsSignIn` directly (not `idle`) with a notice: "That sign-in link didn't work — it may have expired, already been used, or been opened on a different device than the one you requested it from. Enter your email again to get a new one." (see §4b for why this wording covers the different-device case) — skipping the user having to re-paste the URL, but still requiring a fresh email submission (no session exists yet).
- If `next` is missing or malformed on the failure path, fall back to a plain `/diagnostic?authError=expired` (no url) — the user re-pastes their link, same as a first-time visit.

This means the "preserve the URL" guarantee holds on **both** branches of the round trip, not just the happy path.

---

## 3. Form design decisions

Applying `form-design` to the new email field and the existing URL field on the same page:

- **Layout:** single column, top-aligned label — matches the existing URL field, so the two forms (URL form in `idle`/`diagnosticError`, email form in `needsSignIn`/`magicLinkError`) read as one consistent page, not two different products.
- **Email field:** `<label>Email</label>` (persistent, not placeholder-only), `type="email"`, no autocomplete restriction (allow browser autofill — reduces friction for a one-field form).
- **Validation timing:** validate on blur, not on keystroke, per `form-design`. Client-side check is a basic shape check (`/\S+@\S+\.\S+/`) purely to catch obvious typos before a network round trip — the authoritative check is Supabase's own on submit.
- **Error message copy:** "Enter a valid email address, like you@example.com" (explains the fix, not just "Invalid email") for the client-side blur check. Server-side failures get their own copy (see §4).
- **Error placement:** directly below the email field, not at the top of the form — this is a one-field form, so a top-of-form summary would be redundant.
- **Existing URL field touch-up (folded into this work since the file is already being modified):** no structural change — it already has a persistent label and preserves its value on error. Two small additions: (a) the error `<p role="alert">` moves conceptually under the *field* it's about (it already renders below the button, which is fine for a single-field form per `form-design`'s "server-side errors: summarize at the top if multiple fields are affected" — n/a here since there's only one field); (b) button loading text gets the spinner treatment described in §1/§4, replacing the plain "Analyzing…" text swap.

---

## 4. Error handling decisions

Applying `error-handling-ux`'s "what happened / why / what to do" format to each error surface this flow introduces or touches:

### 4a. Magic-link request failure (`magicLinkError`)

| Cause | Message |
|---|---|
| Invalid email (server rejects format) | "That doesn't look like a valid email address. Double-check it and try again." |
| Supabase rate-limited the request | "You've requested a few sign-in links in a row. Wait a minute and try again." |
| Network/fetch error | "We couldn't reach the server. Check your connection and try again." |

All three keep the email value in the field and offer the same retry path (`EDIT_URL` → `idle`, or simply resubmitting the form directly from `magicLinkError`, both immediately available). Per `error-handling-ux`'s prevention layer, the client-side blur validation (§3) already catches the most common "invalid email" case before it ever reaches the server.

Security note: regardless of whether the email belongs to an existing account, the success message in `checkEmail` is identical ("If an account exists for `<email>`, we've sent a sign-in link.") — this avoids leaking account existence via response differences, standard practice for magic-link/OTP flows.

### 4b. Expired/invalid magic-link callback code

Handled structurally in §2 — the user lands back in `needsSignIn` (URL preserved) with the message "That sign-in link didn't work — it may have expired, already been used, or been opened on a different device than the one you requested it from. Enter your email again to get a new one." (Revised from an earlier "expired or was already used" wording once it became clear that opening the link on a different device than the one that requested it — an inherent limit of `@supabase/ssr`'s PKCE flow — is the most common real-world cause, and the original copy didn't mention it.) This is still a "what happened + why + what to do" message in one sentence, appropriate for a low-stakes, easily-retried failure.

### 4c. Diagnostic-submission errors (unchanged server responses, new/confirmed client copy)

| Status | Message |
|---|---|
| 400 (unsupported/bad URL) | "That link isn't a YouTube, TikTok, or Instagram video or post we can read. Double-check the URL and try again." |
| 429 (rate-limited) | Use the handler's existing message verbatim (already correct: distinguishes profile-limit vs IP-limit) plus, when `retryAfter` is present, append "You can try again after `<formatted date>`." |
| 500 / network error | "Something went wrong on our end generating your report. Try again in a moment — your link hasn't been used up." (The last clause matters: it's the one free diagnostic, so the user needs explicit reassurance that a server error didn't burn their rate-limit slot. This is already true server-side — the rate-limit event is only recorded after a successful save — this message just makes that guarantee visible.) |

All three preserve the URL field value (`diagnosticError` never clears `url`) and are retried directly from that state via `URL_CHANGED`/`SUBMIT_DIAGNOSTIC` — no dedicated retry event.

---

## 5. Loading state decisions

Applying `loading-states`' duration guidelines:

- **`submittingDiagnostic`** (expected 5–15s: external API fetch + Claude generation): spinner + text, escalating to a more descriptive message after 8s (see §1). This is the "1–10s: clear loading state" / "over 10s: detailed progress" boundary case — escalating covers both.
- **`submittingMagicLink`** (expected <2s: single Supabase call): spinner + static text, no escalation tier needed.
- Both use a small inline spinner (same visual treatment, reused as a shared bit of UI rather than two one-off implementations) rather than a full-page loading state — this is a single-button interaction, not a page navigation.

---

## 6. File/interface plan preview

(Full task breakdown belongs in the implementation plan — `writing-plans` — this is just the shape for continuity.)

- `lib/auth/magic-link.ts` — pure, testable core: `requestMagicLink(deps, { email, redirectPath })`, dependency-injected Supabase auth client (matches the `lib/diagnostic/handler.ts` DI pattern already established).
- `app/api/auth/magic-link/route.ts` — thin wrapper wiring real Supabase client into `requestMagicLink`.
- `app/auth/callback/route.ts` — `GET` handler implementing §2's redirect logic, using the modern `getAll`/`setAll` cookie API (`@supabase/ssr`'s current recommended pattern — the existing `lib/supabase/server.ts` helpers use the deprecated `get/set/remove` overload for the main client, but a new `middleware.ts` and this callback route should use `getAll`/`setAll` for session-refresh correctness).
- `middleware.ts` — new; refreshes the Supabase session cookie on navigation (required for magic-link session persistence across the redirect).
- `components/SignInPrompt.tsx` — the email field + its own submit/loading/error rendering for `needsSignIn`/`submittingMagicLink`/`magicLinkError`/`checkEmail`.
- `app/diagnostic/page.tsx` — modified to hold the full state machine from §1 (replacing today's `{url, error, submitting}` booleans with a discriminated-union state value), and to read `?url=`/`?authError=` on mount.

---

## Open items carried to the plan, not resolved here

- Exact spinner SVG/markup — implementation detail, not a design decision.
- Whether `middleware.ts`'s matcher should exclude static assets — standard Next.js boilerplate, not novel to this feature.
