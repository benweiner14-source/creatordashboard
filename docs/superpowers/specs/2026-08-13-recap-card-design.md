# Recap Card Design Spec

**Date:** 2026-08-13
**Classification:** Architectural (per `brainstorming`) — new subsystem (`lib/recap/`, `app/recap/`, `app/api/recap/`, new `profiles` columns, new `recap_cards` table, a new profile-level scrape mode on `lib/integrations/scraper.ts`, and a new YouTube channel-lookup method).
**Status:** Approved for planning. Decisions below were confirmed via `AskUserQuestion` during brainstorming; this doc turns them into an implementable design.

## What this is

A shareable monthly stats card ("Recap Card" in the product brief) that a
creator can post to their own social feed. Adapted from the reference
`2k-monthly-report` skill (`docs/reference/creator-dashboard-source-skills-export.md`,
§2) — but that skill produces a multi-page branded PDF for an internal/exec
audience from manually-exported CSVs. This feature is a different genre: one
consumer-facing, brand-forward image, sourced automatically from data this
app fetches itself, not a report the creator uploads exports to build.

## Decisions already made (inputs to this spec, not open questions)

1. **Output format:** a single shareable image (PNG), not a PDF report —
   headline stat, top post, brief highlights. No multi-paragraph commentary.
2. **Data source:** the app's own connected data, not a CSV upload. Since
   the app has no OAuth/channel-connection infra today, "connected" means a
   creator saves a public handle/profile URL per platform (no OAuth token),
   and generation pulls that profile's public posts itself.
3. **Scraping model:** profile-level, not per-post-pasted-by-creator. This
   was chosen deliberately over the lower-risk "creator pastes their own
   post URLs" alternative, given the cost/timeout risks below are mitigated
   by making generation on-demand + cached rather than a scheduled bulk
   sweep.
4. **Cost/timeout mitigation is load-bearing, not optional:** generation is
   on-demand (a button, not a cron for every creator), rate-limited, capped
   in result size, and cached per `(profile, month)` so a creator visiting
   the page twice doesn't re-trigger a scrape. See §3.
5. **Card scope:** one combined card per creator per month, aggregating
   across every platform they've connected — not a separate card per
   platform.
6. **Placement:** a single new `/recap` page owns the whole flow (connect
   handles → generate → view/download), not a separate settings page. There
   is no settings/account page in this app today; splitting connection into
   one wouldn't serve anything else yet.
7. **Apify/handle-based sourcing (decision #2) is a deliberate bridge, not a
   permanent architecture — confirmed 2026-08-13.** The Recap Card is a
   "your own connected account" feature, which is exactly what OAuth is
   built for (unlike the Diagnostic's paste-anyone's-link hook or a
   someone-else's-channel feature, where OAuth is structurally impossible).
   Official TikTok Content Posting/Display API and Instagram Graph API
   access would be faster, more stable, and ToS-clean versus scraping — but
   both gate real scopes behind an app-review process that can take weeks
   and typically wants to see a working product first, a real
   chicken-and-egg blocker pre-launch. Decision: ship on Apify/handles now;
   treat OAuth for TikTok/Instagram as a fast-follow once the product has
   enough traction to submit for platform review. The DI boundary in
   `lib/recap/handler.ts` (spec §2) isolates this — swapping
   `fetchProfilePosts`'s internals for an OAuth-backed call later is a
   contained change to `lib/integrations/scraper.ts` and its wiring, not a
   redesign of aggregation, rate-limiting, caching, or the card itself.
   YouTube is unaffected either way: the public Data API this plan already
   uses (decision #2) is sufficient for what the card needs; OAuth to the
   YouTube Analytics API (retention curves, true watch-time) is a
   Diagnostic-feature upgrade this card doesn't use, tracked separately.

## Non-goals

- No OAuth, no stored access tokens for any platform.
- No scheduled/automatic generation — nothing runs for a creator who hasn't
  clicked "Generate."
- No per-platform cards, no historical gallery of past months in v1 (a
  `recap_cards` row per month is stored, but browsing past months is a
  fast-follow, not part of this build).
- No AI-written commentary paragraphs (unlike the reference skill) — the
  card is numbers + one top-post callout, not analysis.
- No retrofit of `lib/integrations/scraper.ts`'s existing single-post
  `fetchPost` — it keeps its current sync, un-retried behavior; only the new
  profile-scrape path gets async run-then-poll + retry.

---

## 1. Data model & platform connection

### `profiles` — three new nullable columns

```sql
alter table public.profiles
  add column youtube_channel_handle text,
  add column tiktok_handle text,
  add column instagram_handle text;
```

A creator enters a handle or a full profile URL per platform on `/recap`;
input is normalized to a bare handle at save time (see §4 for validation).
At least one platform must be connected before generation is offered. There
is no "primary platform" concept — all connected platforms feed into the one
combined card.

### `recap_cards` — one row per creator per month

```sql
create table if not exists public.recap_cards (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  month date not null,  -- normalized to the 1st of the month
  platform_data jsonb not null,  -- per-platform: { views, likes, comments, postCount }
  totals jsonb not null,         -- combined: { views, likes, comments, postCount }
  top_post jsonb not null,       -- { platform, captionOrTitle, viewCount, permalink }
  warnings text[] not null default '{}',  -- e.g. ["instagram_scrape_failed"]
  generated_at timestamptz not null default now(),
  unique (profile_id, month)
);

alter table public.recap_cards enable row level security;

create policy "Recap cards are viewable by owner"
  on public.recap_cards for select
  using (auth.uid() = profile_id);
```

This table stores **computed stats**, never a binary image. The unique
constraint on `(profile_id, month)` is the mechanism that makes generation
idempotent (§3) — a second `POST /api/recap` in the same month returns the
existing row instead of re-scraping.

### Image rendering: on demand, not stored

`/recap/[id]/image` is a route using Next's built-in `ImageResponse`
(`next/og`, Satori-based — ships with Next itself, no Playwright/Chromium
dependency, no binary storage bucket to manage). It reads the `recap_cards`
row's JSON and renders a PNG on each request, with HTTP caching headers
(the underlying data never changes after generation, so this is safe to
cache aggressively). This makes the route itself a stable, directly
shareable/embeddable URL — a creator can drop it straight into anywhere
that accepts an image URL, and it doubles as the page's own `og:image`.

Per `AGENTS.md`, `ImageResponse`'s exact API surface must be read from
`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/image-response.md`
before implementation — this Next.js build has diverged from training data
before (see the `middleware.ts` → `proxy.ts` rename earlier in this repo's
history) and this doc confirms the current API still matches what's
proposed here before code is written against it.

---

## 2. Generation pipeline

### `POST /api/recap`

Auth required (401 if signed out, matching `handleDiagnosticRequest`'s
shape). Flow:

1. Look up the caller's saved handles from `profiles`. If none are
   connected, 400.
2. Check for an existing `recap_cards` row for `(profile_id,
   current_month)`. If found, return it — **no scrape happens**. This is
   the idempotency guarantee that makes "on-demand" safe to also be
   "cheap": a page refresh, a double-click, or a creator returning next week
   to grab the image again never re-triggers Apify/YouTube calls.
3. Otherwise, run `checkAndRecordRateLimit` (existing `RateLimitStore`, new
   `recap_generation` event type) as a coarse abuse guard, using its
   existing per-call override params: `profileLimit: 5, ipLimit: 10,
   windowDays: 1` (5 generation attempts per profile per day, 10 per IP per
   day — mirrors how `lib/auth/magic-link.ts` already overrides the same
   defaults for its own event type). The monthly unique constraint is the
   real cost cap; this only stops a retry-storm if scraping is failing
   repeatedly (network blip, Apify outage) from re-hammering paid calls.
4. For each connected platform, fetch that platform's posts for the current
   calendar month (§2.1–2.2). A platform that throws or returns zero posts
   is recorded in `warnings` and excluded from the breakdown — not a hard
   failure.
5. If **every** connected platform came back empty, return a distinct
   "nothing published this month" error (maps to the page's
   `generationFailed` state, §3) rather than a generic 500. No
   `recap_cards` row is written in this case, so the creator can retry
   later in the same month without the unique constraint blocking them.
6. Otherwise aggregate (§2.3), insert the `recap_cards` row, return it.

### 2.1 TikTok/Instagram: profile-level scrape

New function on `lib/integrations/scraper.ts`, `fetchProfilePosts(handle)`,
distinct from the existing single-post `fetchPost(url)`:

- Calls Apify's **async** run-then-poll endpoints (`POST
  /v2/acts/{actorId}/runs` then poll `GET
  /v2/actor-runs/{runId}` until finished, then fetch the dataset) —
  **not** `run-sync-get-dataset-items`, which today's `fetchPost` uses. A
  profile crawl runs long enough to risk that endpoint's response-timeout
  ceiling; single-post fetches don't, so `fetchPost` is left as-is.
- `resultsLimit` capped (~50 posts) on the actor call itself. This bounds
  cost per creator regardless of how prolific they are, at the cost of a
  theoretical miss for a creator who posts more than that in one month —
  accepted as a reasonable v1 limit, revisit if it's ever hit in practice.
- Basic retry-with-backoff on transient failures (a proxy ban, a 5xx from
  Apify) — worth the resilience here in a way it isn't for the low-volume,
  human-triggered single-post path.
- Filters results to the target calendar month using each item's own
  timestamp, **excluding** rows with an unparseable/blank date rather than
  including them by default — same rule the reference skill's design notes
  call out as a real bug it had to fix (`docs/reference/...md` §374-406).

### 2.2 YouTube: channel uploads via existing API key

No OAuth needed — channel uploads are public data. New method on
`lib/integrations/youtube.ts`'s client:

1. `channels.list(part=contentDetails, forHandle=<handle>)` → resolves the
   channel's uploads-playlist ID. (`forHandle` is a real, current YouTube
   Data API v3 parameter — confirm against the live API docs at
   implementation time, not from training-data memory, since platform APIs
   are exactly the kind of thing that drifts.)
2. `playlistItems.list(playlistId=<uploads>, maxResults=50)` → recent video
   IDs, capped the same way as the Apify path.
3. `videos.list(part=statistics,snippet)` on those IDs → reuses the
   existing `VideoMetadata` shape.
4. Same month-filter/exclude-unparseable-dates rule as §2.1.

### 2.3 Aggregation

- `totals`: sum of `viewCount`/`likeCount`/`commentCount` and a post count,
  across every platform that returned data.
- `platform_data`: the same shape, broken out per platform, for the card's
  per-platform row.
- `top_post`: the single highest-`viewCount` post across all platforms that
  returned data (not per-platform top posts — one overall top post, per the
  combined-card decision).

---

## 3. Card rendering & page UI

### The image (`/recap/[id]/image`)

A vertical, brand-forward card, rendered via `ImageResponse` from the
`recap_cards` row:

- Creator display name + month/year header.
- One large headline stat: total views this month, formatted compactly
  (e.g. "127K").
- 2–3 secondary stats: total posts, total likes/engagement.
- A top-post callout: platform icon, view count, caption/title snippet.
- A small per-platform breakdown row: icon + view count per connected
  platform.
- App wordmark/footer.

No paragraph commentary, no per-platform tables, no MoM/YoY history — that
register belongs to the reference skill's report genre, not this one.

### `/recap` page states

Explicit named states (same discipline as the sign-in flow's state
machine — see `docs/superpowers/specs/2026-08-13-sign-in-flow-design.md`
§1), not ad hoc booleans:

| State | UI shown |
|---|---|
| `noHandlesConnected` | Form: handle/URL field per platform (all optional individually, at least one required to proceed). |
| `readyToGenerate` | Handles saved (or already on file from a prior visit); "Generate this month's recap" button. Also reachable by editing handles from `cardReady`. |
| `generating` | Button disabled + spinner. Escalating status text past ~8s (this can run longer than the Diagnostic flow, given profile scrapes) — same pattern as `submittingDiagnostic` in the sign-in flow spec. |
| `cardReady` | Rendered image, download link, copy-link affordance. Reached either right after generation or immediately on page load if this month's row already exists (`alreadyGeneratedThisMonth` collapses into this state — it's the same UI, just a different entry path). |
| `generationFailed` | All connected platforms returned nothing this month, or a hard error. Specific message for the empty-month case vs. a generic one for real errors. |

Every state has a way out: `generationFailed` and `cardReady` both offer a
path back to `readyToGenerate` (edit handles / regenerate next month).

### Download

A same-origin `<a href="/recap/[id]/image" download>` — no separate export
endpoint, since the image route already serves a real PNG.

---

## 4. Error handling & edge cases

- **Handle validation:** accepts either a bare handle or a full profile URL
  per platform (mirrors Diagnostic's existing acceptance of full post
  URLs); normalized to a stored handle at save time. Invalid/unparseable
  input is rejected inline on save, not deferred to generation time.
- **Partial-platform failure:** logged server-side and surfaced to the
  client as a `warnings` list (e.g. "Instagram couldn't be reached this
  time") on the `recap_cards` row, but does not block generation if at
  least one platform succeeded.
- **All-platforms-empty:** a distinct failure path (§2, step 5) — no row
  written, specific "nothing published this month" messaging, retryable
  without hitting the unique-constraint idempotency guard.
- **Rate limit exceeded:** same 429 shape as the Diagnostic handler
  (`reason`, optional `retryAfter`).

## Testing

- Unit tests (pattern: `lib/diagnostic/*.test.ts`):
  - Month-filtering / unparseable-date-exclusion logic.
  - Aggregation: totals and top-post selection across mixed-platform input,
    including the "one platform empty" and "all platforms empty" cases.
  - Rate-limit wiring, reusing the existing fake `RateLimitStore`.
  - Handler branching: cached-row short-circuit, partial-failure
    `warnings`, all-empty failure.
- One Playwright E2E: connect a handle (mocked scraper/YouTube responses),
  generate, see the card image render.
- `ImageResponse` output itself is treated as presentational, not
  unit-tested beyond "renders without throwing" — consistent with this
  codebase not unit-testing its other JSX report pages either.
