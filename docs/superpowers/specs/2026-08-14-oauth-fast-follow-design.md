# OAuth Fast-Follow Design Spec

**Date:** 2026-08-14
**Classification:** Architectural (per `brainstorming`) — new subsystem (`lib/oauth/`, `lib/crypto.ts`, `app/api/oauth/[platform]/*`, a new `platform_connections` table), plus a DI-boundary change to an already-shipped feature (`lib/recap/handler.ts`).
**Status:** Approved for planning. Decisions below were confirmed via `AskUserQuestion` during brainstorming; this doc turns them into an implementable design.

## What this is

Official OAuth connections to TikTok and Instagram, replacing the Apify/handle-based scraping bridge for Recap Card **on a per-platform basis** — the exact fast-follow flagged as deliberate, not accidental, when Recap Card shipped (`docs/superpowers/specs/2026-08-13-recap-card-design.md` decision #7): "ship on Apify/handles now; treat OAuth for TikTok/Instagram as a fast-follow once the product has enough traction to submit for platform review." Both Recap Card and Weekly Content Ideas are now live on `main`; this is that fast-follow.

YouTube is unaffected — the public YouTube Data API that Recap Card already uses for channel uploads needs no OAuth and stays exactly as it is. Diagnostic and Weekly Content Ideas are unaffected entirely; neither is in scope for this pass.

## Decisions already made (inputs to this spec, not open questions)

1. **Platform scope: TikTok + Instagram OAuth**, both, for Recap Card. YouTube OAuth (Analytics API, for a Diagnostic own-channel upgrade) was explicitly left out — confirmed as a separate, not-yet-scoped idea, not part of this fast-follow.
2. **Per-platform replacement, not an all-or-nothing switch.** Once a creator connects a platform via OAuth, that platform's Recap Card data comes from the official API going forward. An unconnected platform keeps using the existing saved-handle + Apify path exactly as it does today. Both mechanisms coexist permanently, decided per platform per creator — not a migration that retires the Apify path.
3. **App-review gating handled by building against sandbox/development-tier scopes now**, submitting for full platform review in parallel. The code, schema, and UI ship complete and testable end-to-end (against each platform's test-user tier) regardless of when — or whether yet — review clears; going live for all creators is a developer-console mode flip, not a code change.
4. **Connect/disconnect UI lives on the existing `/recap` page** — no new settings/connections page. Matches Recap Card decision #6 (no settings/account page exists in this app yet).
5. **Architecture: Approach A** — new hand-rolled OAuth provider clients (`lib/integrations/tiktok-oauth.ts`, `lib/integrations/instagram-oauth.ts`) returning the same `ProfilePost[]` shape the existing Apify path already produces; the connected-vs-not branching decision lives in `lib/recap/handler.ts`, not inside `lib/integrations/scraper.ts`. `lib/recap/aggregate.ts` needs zero changes.

## Non-goals

- No YouTube OAuth, no Diagnostic changes, no Weekly Content Ideas changes.
- No proactive/background token refresh — no cron/scheduled-job infrastructure exists in this app today, and this doesn't introduce one. Refresh is lazy, at use time only (§3).
- No multi-account support — one connection per `(profile, platform)`, same cardinality as one handle per platform today.
- No historical backfill beyond the existing per-generation result cap that already bounds the Apify path.
- No forced migration off the Apify/handle path — a creator who never connects OAuth keeps working exactly as they do on `main` today.
- No new rate-limit event type for connect/disconnect (see §6 — the flow is self-limiting by requiring a real consent-screen interaction; disconnect is a trivial delete).

---

## 1. Data model & token storage

### `platform_connections` — new table, one row per creator per connected platform

```sql
create table if not exists public.platform_connections (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  platform text not null check (platform in ('tiktok', 'instagram')),
  provider_user_id text not null,
  access_token_encrypted text not null,
  refresh_token_encrypted text,
  expires_at timestamptz,
  scopes text[] not null default '{}',
  connected_at timestamptz not null default now(),
  unique (profile_id, platform)
);

alter table public.platform_connections enable row level security;

create policy "Platform connections are viewable by owner"
  on public.platform_connections for select
  using (auth.uid() = profile_id);
```

A separate table rather than more `profiles` columns — this is generation-time state with its own lifecycle (connect, refresh, expire, disconnect), the same reasoning that put `recap_cards` and `weekly_digests` in their own tables rather than on `profiles`. `unique(profile_id, platform)` means re-connecting (re-auth) replaces the existing row via upsert, not a second row.

`profiles.tiktok_handle`/`instagram_handle` (added for Recap Card) are untouched by this plan — no migration removes or changes them. They remain the fallback path's input for an unconnected platform.

### Tokens are encrypted at rest

A new `lib/crypto.ts` module (`encryptToken`/`decryptToken`, AES-256-GCM via Node's built-in `crypto`, keyed by a new `OAUTH_TOKEN_ENCRYPTION_KEY` env var — 32 random bytes, documented in `.env.example` with a `openssl rand -hex 32`-style generation hint matching the existing `RATE_LIMIT_IP_SALT` convention) wraps `access_token`/`refresh_token` before every write and unwraps them at read time. This mirrors the codebase's existing precedent of never storing sensitive values raw (`lib/rate-limit.ts` already salts and hashes IPs rather than storing them directly). Application code only ever touches `platform_connections` server-side via the service-role client — the same access pattern already used for `recap_cards` and `weekly_digests` — so the RLS owner-select policy above is defense-in-depth, not the actual access path; even under it, what the client could see is ciphertext, never a usable token.

---

## 2. OAuth connect/callback flow

### Routes

- **`GET /api/oauth/[platform]/authorize`** — requires a signed-in profile (401 if not, though in practice the connect link only renders on `/recap` once already signed in). Generates a random nonce, sets it in a short-lived `HttpOnly`, `SameSite=Lax` cookie, and 302-redirects to the provider's authorize URL with `client_id`, `redirect_uri` (built from the request's own origin at runtime, the same way `app/api/auth/magic-link/route.ts` already does — no new env var needed for it), `scope`, `state=<nonce>`, `response_type=code`.
- **`GET /api/oauth/[platform]/callback`** — reads `code`/`state`/`error` query params. Compares `state` against the nonce cookie — a mismatch, missing cookie, or expired cookie fails closed (§6) with no token exchange attempted. On a match, exchanges `code` for an access token (+ refresh token, where the provider issues one) at the provider's token endpoint, makes one lightweight "who am I" call to obtain a stable `provider_user_id`, encrypts and upserts the `platform_connections` row (`on conflict (profile_id, platform)`), then redirects to `/recap?connected=tiktok` (or `?oauthError=<code>` on any failure branch, §6).
- **`POST /api/oauth/[platform]/disconnect`** — deletes the creator's `platform_connections` row for that platform. Best-effort calls the provider's revoke endpoint where the platform exposes one, but never blocks the local disconnect on that call succeeding — the creator's disconnect intent always takes effect in our own data even if the remote revoke call fails or times out.

Why a cookie-based nonce rather than a signed state token carrying `profileId`: the callback is a normal authenticated request — the Supabase session cookie rides along on the browser redirect — so `profileId` comes from `auth.getUser()` exactly like every other authenticated route in this app. `state`'s only job is proving this callback is a continuation of a request we actually issued, which a random nonce plus a short-lived cookie does without any new signing infrastructure.

### `lib/oauth/` module (new, mirrors `lib/recap/`'s shape)

- **`lib/oauth/providers.ts`** — per-platform config: authorize URL, token URL, refresh mechanics (§3), scopes, client-id/secret env var names. TikTok and Instagram both use an OAuth2 authorization-code flow at the top level, so one generic exchange function serves both, parameterized by this config. **Exact scope strings and endpoint URLs are pulled from each platform's live current developer documentation at implementation time**, not from training-data memory — the same discipline the Recap Card spec already required for `forHandle` and for `ImageResponse`'s API surface, since platform APIs are exactly the kind of thing that drifts.
- **`lib/oauth/handler.ts`** — `handleOAuthCallback(deps, context)`: pure and DI'd, shaped like `lib/auth/callback.ts`'s `handleAuthCallback`. Validates state, exchanges the code, fetches the provider user id, calls an injected `saveConnection`, returns a redirect URL (success or one of the error branches in §6).
- **`lib/oauth/connections.ts`** — `getPlatformConnection(deps, profileId, platform)`: reads the row, decrypts, and performs the lazy refresh described in §3, returning a token guaranteed usable for the immediate call (or `null` if there's no connection or refresh failed and the connection was cleared).

---

## 3. Token refresh — lazy, at use time, no scheduled job

`getPlatformConnection` (§2) is the only place refresh happens: invoked only when Recap Card generation is actually about to fetch that platform's posts, it checks `expires_at`, and refreshes first if the token is expired or within a short buffer of expiring. This matches the whole app's existing on-demand philosophy — nothing here introduces the first cron/scheduled job this codebase has ever had.

Two real provider differences the refresh step must accommodate — the plan implements this as a per-platform pluggable step in `lib/oauth/providers.ts`, not a single universal shape:

- **TikTok** issues a distinct `refresh_token` — refreshing means presenting it to the token endpoint for a new access token, and TikTok rotates the refresh token on each use, so the new one must be re-stored too.
- **Instagram/Graph API** doesn't use a classic refresh-token grant — a long-lived access token is extended by presenting *itself* to a refresh endpoint before it expires; there is no separate refresh token to store.

**When refresh fails** (the refresh token, or the long-lived token itself, has expired or been revoked by the creator in their platform's own account settings — the only way this ordinarily happens), the connection is treated as broken: the `platform_connections` row is deleted, and the current Recap Card generation falls back to that platform's Apify/handle path if a handle is on file, or simply excludes that platform (identical to any other single-platform fetch failure today) if not. This surfaces through the existing `recap_cards.warnings` array — a new warning code (e.g. `tiktok_connection_expired`) reusing the mechanism Recap Card already has, not a new one. The next `/recap` page load shows that platform as disconnected, because the row is gone.

Connection status shown on `/recap` is a direct read of row-existence + `expires_at` from the bootstrap response — not a live provider check on every page view.

---

## 4. Recap Card integration

`lib/recap/handler.ts` gains one new injected dependency: `getPlatformConnection: (profileId, platform) => Promise<{ accessToken: string } | null>` (§3). For TikTok and Instagram specifically, the per-platform fetch step becomes:

```
for platform of ['tiktok', 'instagram']:
  connection = await deps.getPlatformConnection(profileId, platform)
  if connection:
    posts = await deps.oauthClients[platform].fetchProfilePosts(connection.accessToken)   // new
  else if handles[platform]:
    posts = await deps.scraperClient.fetchProfilePosts(platform, handles[platform])        // existing, unchanged
  else:
    continue  // neither connected nor handle-saved
```

YouTube's branch is untouched. `lib/recap/aggregate.ts` requires zero changes: both paths return identical `ProfilePost[]` shapes (`id`, `caption`, `publishedAt`, `viewCount`, `likeCount`, `commentCount`, `permalink`), so aggregation, month-filtering, and the `warnings` mechanism work identically regardless of which path fetched the data. The OAuth-fetched post count is capped the same way the Apify path's `PROFILE_SCRAPE_RESULTS_LIMIT` already bounds cost — an equivalent cap on the new provider clients' calls.

---

## 5. `/recap` page UI

Each of TikTok's and Instagram's existing handle-field rows gains a connect/disconnect affordance. YouTube's row is unchanged.

- **Not connected:** the existing handle input stays as-is, plus a new "Connect via TikTok" (or Instagram) link next to it. Both remain usable side by side — pasting a handle for the fallback path and clicking Connect are independent actions; if a connection is later made, it simply takes priority per §4's branching, and the saved handle stays underneath it for if the creator ever disconnects.
- **Connected:** the handle input is replaced by a "Connected via TikTok ✓" status line and a "Disconnect" button.
- **The connect link is a real top-level navigation to `GET /api/oauth/tiktok/authorize`**, not a fetch call — it must be a full browser navigation so the provider's consent screen can render and redirect back. After the round trip, the browser lands back on `/recap?connected=tiktok` (or `?oauthError=...`), read once on mount for a one-time toast, then cleared from the URL.
- **`GET /api/recap`'s bootstrap response gains a `connections` field** — `{ tiktok: boolean, instagram: boolean }`, read from `platform_connections` row-existence — alongside the existing `handles`. This is the actual source of truth the page renders from; the `?connected=` query param only drives the transient toast, since a plain reload with no query param still has to show the right state.
- **Generation gating** changes from "at least one handle saved" to "at least one platform has a handle saved OR an active connection." Connecting via OAuth alone (no handle needed for that platform) is enough to unlock Generate.
- **Connecting does not auto-trigger generation** — Generate stays a separate, deliberate action, same as today.
- **Disconnect** POSTs to `/api/oauth/[platform]/disconnect`, then updates that platform's connection status in page state via a small new event on the existing `lib/recap/page-state.ts` reducer — not a new state machine.

---

## 6. Sandbox mode, error handling, edge cases

### Sandbox/development mode

Both TikTok's and Instagram's developer platforms have a development/sandbox tier — this entire feature (OAuth flow, token exchange, refresh, storage, the Recap Card integration) is built and fully exercisable end-to-end against that tier (limited to test users registered in each platform's own developer console) without waiting on app review. When review clears, no code in this repo changes — only the app's mode flips in the platform's developer console, and production client-id/secret values may need to be set in the env vars in place of sandbox ones. Whether sandbox and production credentials differ, or it's the same app id with a mode toggle, is confirmed per-platform at implementation time against live current docs — the same discipline already required for `forHandle`, `ImageResponse`, and every endpoint URL in this spec.

### Error handling

- **Creator denies consent** on the provider's screen → provider redirects back with `error=access_denied` instead of `code` → `/recap?oauthError=denied`, friendly copy ("no problem — your existing handle-based setup is unaffected").
- **State mismatch** (missing/wrong/expired nonce cookie, or the callback URL hit directly without ever visiting authorize) → fails closed, `/recap?oauthError=invalid_state`, generic "something went wrong, try connecting again."
- **Token exchange fails** (network/provider error) → `/recap?oauthError=exchange_failed`.
- **Refresh fails at generation time** → covered in §3 (row deleted, surfaced via `recap_cards.warnings`).
- **No new rate-limit event type** for authorize/callback/disconnect — connecting requires a real human clicking through a real consent screen each time (self-limiting), and disconnect is a trivial DB delete. This is a deliberate decision, not an oversight.

### New environment variables

Added to `.env.example`, following the existing documentation convention:

```
# Token encryption — generate with `openssl rand -hex 32`
OAUTH_TOKEN_ENCRYPTION_KEY=

# TikTok for Developers — https://developers.tiktok.com
TIKTOK_CLIENT_ID=
TIKTOK_CLIENT_SECRET=

# Meta for Developers (Instagram Graph API) — https://developers.facebook.com
INSTAGRAM_CLIENT_ID=
INSTAGRAM_CLIENT_SECRET=
```

No new env var is needed for the OAuth redirect URI — it's built from the incoming request's own origin at runtime, the same way `app/api/auth/magic-link/route.ts` already constructs its redirect URL.

---

## Testing

Same pattern as every other feature in this codebase: pure, dependency-injected functions tested with fakes.

- `lib/crypto.ts`: an encrypt→decrypt round-trip test, plus a test that ciphertext differs from plaintext.
- `lib/oauth/handler.ts`: a test suite shaped like `lib/auth/callback.ts`'s existing one — state validation success/failure, successful code exchange, denied-consent branch, exchange-failure branch — using a fake token-exchange dependency.
- `lib/oauth/connections.ts`: refresh-branching tests (not-expired → no refresh call; expired → refresh called and the row updated; refresh failure → row cleared, `null` returned).
- `lib/recap/handler.ts`: new tests for the OAuth-connected-platform branch, alongside its existing Apify-path tests — connected-and-used, not-connected-falls-back-to-handle, connected-but-refresh-fails-falls-back-or-excludes.
- `lib/recap/handles.ts`/page-state: existing tests updated for the new generation-gating rule (§5) and the new connection-status event.
- One Playwright E2E: exercises `/api/oauth/tiktok/callback` directly with a mocked `code`/matching `state` cookie (skipping the real external redirect — the same way this codebase's other E2E tests mock external network calls) and asserts `/recap` reflects "connected" afterward.
