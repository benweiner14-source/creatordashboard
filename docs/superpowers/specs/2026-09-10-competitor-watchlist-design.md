# Competitor Watchlist Design Spec

**Date:** 2026-09-10
**Classification:** Architectural (per `brainstorming`) — new subsystem (`lib/watchlist/`, two new tables, `app/watchlist/`, `app/api/watchlist/`), reusing substantial existing infrastructure.
**Status:** Approved for planning. Decisions below were confirmed via `AskUserQuestion` during brainstorming; this doc turns them into an implementable design.

## What this is

A saved, recurring version of Creator Strategy Breakdown's one-off channel lookup: a creator adds up to 20 competitor channels/profiles (any mix of YouTube, TikTok, Instagram), and the Watchlist tracks each one's subscriber/follower count, total view count, and video count over time, plus that competitor's current top 5 posts by VPH (views-per-hour). Surfaced from competitive research into how VidIQ's competitor tracking works; the gap it fills is that Strategy Breakdown only supports one-shot, non-persistent lookups — there's no way to keep an eye on the same channel across visits without re-pasting the URL and losing any sense of what changed.

## Decisions already made (inputs to this spec, not open questions)

1. **Platform scope: any of the three platforms, independent of the user's own connected platform.** A YouTube creator can watch a competitor's TikTok. No new fetch capability required for this — `getChannelUploads` and `fetchProfilePosts` already exist for all three.
2. **Refresh model: on-demand on page visit (stale-while-revalidate), not a scheduled background job.** This repo has no cron/background-job infrastructure yet (the weekly digest email is the one exception, and it's out of scope here); standing one up is a bigger, separate lift. Visiting `/watchlist` refreshes any entry whose latest snapshot is older than a TTL.
3. **Tier: paid for the parts that cost money — adding an entry and refreshing one — gated the same way as Strategy Breakdown and Recap Card (`hasActiveSubscription`, 402 if not subscribed).** Viewing already-saved entries and their cached snapshots is not subscription-gated (only sign-in-gated): it costs nothing, and locking a lapsed subscriber out of data they already paid to generate would be a worse experience than simply not refreshing it further. This mirrors the cost-based reasoning behind every other rate-limit/paid-gate decision in this codebase — the gate sits in front of the expensive action, not in front of read access to its past results.
4. **Refresh abuse guard: per-entry TTL *and* a daily cap on total refreshes per profile.** TTL alone lets a user delete-and-re-add an entry to dodge staleness (a new row has no prior snapshot, so it always looks due); a shared daily budget via `checkAndRecordRateLimit` closes that loophole without new infrastructure.
5. **VPH pool: the most recent ~50 uploads per refresh**, the same cap `getChannelUploads`/`fetchProfilePosts` already use — no new "since added" cursor tracking.
6. **Follower-count fallback: store `null` and show "—" when a scraped platform doesn't return one.** YouTube's subscriber count is reliably available via `channels.list`; Apify's TikTok/Instagram actors return it inconsistently. Treating a missing count as a hard failure would make TikTok/Instagram entries fail far more than YouTube ones over a field that's secondary to VPH/top-posts.
7. **Historical deltas: store a snapshot row on every refresh**, not just latest-state-in-place. This is the feature's actual value over a plain lookup — "+1.2k subscribers this week" — and is what VidIQ's competitor tracking is actually offering.

## Why a new module, reusing Strategy Breakdown's shape

This is structurally closer to Strategy Breakdown than to Recap Card: it looks up *someone else's* channel using the same two fetchers and the same URL→platform→handle resolution Strategy Breakdown already established (`detectHandlePlatform` / `normalizeHandle` from `lib/recap/handles.ts`). What's actually new:

- **Persistence shape**: Strategy Breakdown writes one row per lookup and never revisits it. Watchlist needs a *tracked* entry (survives across visits) plus a *time series* of snapshots under it — a materially different data model, not a copy of `strategy_breakdowns`.
- **Channel-level stats beyond post lists**: neither `youtube.ts` nor `scraper.ts` currently fetches subscriber/follower counts or channel-level totals — only per-video/per-post stats. This is genuinely new fetch capability, additive to both clients.
- **A rate-limit shape existing features don't have**: every other rate-limited feature is "one action, checked once." Watchlist's cost scales with *how many stale entries a single page visit needs to refresh*, which is why the abuse guard (decision 4) is a new eventType, not a reuse of an existing one.

Everything else — aggregation math shape, Claude-free (no LLM call needed here; see Non-goals), owner-only RLS, the paid-gate/rate-limit/fetch/save handler order — follows Strategy Breakdown's precedent directly.

## Non-goals

- **No Claude/LLM call.** Unlike Diagnostic/Strategy Breakdown/Ideas, this feature is a data table plus deltas, not a plain-English narrative. Nothing here is ambiguous enough to need explaining — a subscriber delta and a ranked post list speak for themselves. (If a narrative layer is wanted later, it's a separate follow-up, not part of this build.)
- **No scheduled background refresh.** Explicitly deferred per decision 2 — would need new infra (e.g. Vercel Cron) this repo doesn't have.
- **No "since added" VPH window.** Per decision 5, VPH is always computed over the latest ~50 fetched posts, not filtered to posts published after the entry was created.
- **No cross-profile visibility.** Entries and snapshots are owner-only, like every other feature's data — no shared/public watchlist view.
- **No editing an entry's platform/handle after creation.** Adding a wrong URL means delete and re-add, same as there being no "edit channel" on Strategy Breakdown.

---

## 1. Data model

New migration, reusing the existing `diagnostic_platform` enum:

```sql
create table if not exists public.watchlist_entries (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  platform public.diagnostic_platform not null,
  handle text not null,
  url text not null,
  label text,
  last_error text,
  created_at timestamptz not null default now(),
  unique (profile_id, platform, handle)
);

alter table public.watchlist_entries enable row level security;

create policy "Watchlist entries are viewable by owner"
  on public.watchlist_entries for select
  using ((select auth.uid()) = profile_id);

create policy "Watchlist entries are insertable by owner"
  on public.watchlist_entries for insert
  with check ((select auth.uid()) = profile_id);

create policy "Watchlist entries are deletable by owner"
  on public.watchlist_entries for delete
  using ((select auth.uid()) = profile_id);

create table if not exists public.watchlist_snapshots (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.watchlist_entries(id) on delete cascade,
  captured_at timestamptz not null default now(),
  subscriber_count integer,
  total_view_count bigint not null,
  video_count integer not null,
  top_posts jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.watchlist_snapshots enable row level security;

create policy "Watchlist snapshots are viewable by owner"
  on public.watchlist_snapshots for select
  using (
    exists (
      select 1 from public.watchlist_entries
      where watchlist_entries.id = watchlist_snapshots.entry_id
        and watchlist_entries.profile_id = (select auth.uid())
    )
  );

create index if not exists watchlist_snapshots_entry_id_captured_at_idx
  on public.watchlist_snapshots (entry_id, captured_at desc);
```

Notes:
- **`(select auth.uid())` form**, not the bare `auth.uid()` `strategy_breakdowns` still uses — this repo's more recent, query-plan-cached convention (`20260815003000_optimize_rls_auth_uid_calls.sql`), applied from the start here rather than needing a follow-up migration.
- **Snapshots have no direct `profile_id`** — ownership is derived through `entry_id`, same indirect-ownership shape `platform_connections`-adjacent tables use. Snapshots are written server-side via the service-role client (like `rate_limit_events`), so the `select`-only policy is defense-in-depth, not the primary write path.
- **`subscriber_count` is nullable** (decision 6); `total_view_count`/`video_count` are not, since both fetchers always return a post list to derive them from even when a follower count is missing.
- **`last_error` lives on the entry**, not the snapshot — it reflects "the most recent refresh attempt for this entry failed," and is cleared on the next successful refresh. A failed refresh does not write a snapshot row.
- **No `(profile_id, platform, handle)` uniqueness on snapshots** — many snapshots per entry over time is the point.
- **20-entry cap is application-level**, checked in the handler before insert (`count(*) from watchlist_entries where profile_id = ...`), not a DB constraint — consistent with how this codebase already treats limits that need a friendly error message rather than a raw constraint violation (e.g. rate limiting itself).

`lib/supabase/types.ts` gains `watchlist_entries` and `watchlist_snapshots` Row/Insert/Update entries mirroring `strategy_breakdowns`' shape.

## 2. Fetching: new channel-level stats capability

**`lib/integrations/youtube.ts`** gains one new method on `YouTubeClient`:

```ts
export interface ChannelStats {
  subscriberCount: number | null; // null if the channel has hidden its subscriber count
  totalViewCount: number;
  videoCount: number;
}

// on YouTubeClient:
getChannelStats(handle: string): Promise<ChannelStats>;
```

Implementation: a `channels.list` call with `part=statistics` (mirrors the existing `forHandle` resolution `getChannelUploads` already does with `part=contentDetails` — a second, separate call rather than widening `getChannelUploads`'s existing call, to keep that method's contract unchanged for its existing callers/tests). YouTube's API returns `hiddenSubscriberCount: true` with no `subscriberCount` field when a channel owner has hidden it — mapped to `null`. Throws the existing `ChannelNotFoundError(handle)` when the handle doesn't resolve, same as `getChannelUploads`.

**`lib/integrations/scraper.ts`**: `ProfilePost` and its normalization gain an optional profile-level follower count, extracted best-effort from the same Apify dataset response `fetchProfilePosts` already parses:

```ts
export interface ProfilePost {
  // ...existing fields unchanged...
  followerCount?: number; // best-effort; absent if the actor run didn't include it
}
```

TikTok's `clockworks~tiktok-scraper` actor exposes this at `authorMeta.fans`; Instagram's `apify~instagram-scraper` actor exposes it at `followersCount` on profile-scrape items. Since every item in one `fetchProfilePosts` response is scraped from the same profile, the handler reads it off the first returned post (`posts[0]?.followerCount ?? null`) rather than requiring every item to carry it.

Both additions are purely additive — no existing method signature changes, no existing test needs updating beyond adding new assertions for the new field/method.

## 3. Aggregation (pure, `lib/watchlist/aggregate.ts`)

```ts
export interface ChannelSnapshotInput {
  subscriberCount: number | null;
  totalViewCount: number;
  videoCount: number;
  posts: Array<{ captionOrTitle: string; url: string; viewCount: number; publishedAt: string }>;
}

export interface RankedPost {
  captionOrTitle: string;
  url: string;
  viewCount: number;
  publishedAt: string;
  viewsPerHour: number;
}

export interface SnapshotSummary {
  subscriberCount: number | null;
  totalViewCount: number;
  videoCount: number;
  topPosts: RankedPost[]; // top 5 by viewsPerHour, descending
}

export function computeViewsPerHour(viewCount: number, publishedAt: string, now?: Date): number;
export function buildSnapshotSummary(input: ChannelSnapshotInput, now?: Date): SnapshotSummary;

export interface SnapshotDeltas {
  subscriberDelta: number | null;   // null if either side is null, or no prior snapshot exists at that age
  totalViewDelta: number | null;
  videoDelta: number | null;
  comparedAgainstCapturedAt: string | null;
}

export function computeDeltas(
  latest: { subscriberCount: number | null; totalViewCount: number; videoCount: number },
  previous: { subscriberCount: number | null; totalViewCount: number; videoCount: number; capturedAt: string } | null
): SnapshotDeltas;
```

- `computeViewsPerHour` guards the same way `computeCadence` guards divide-by-zero: a post published less than 1 hour ago uses `hoursElapsed = 1` as a floor, so a brand-new viral post doesn't produce an artificially explosive or `Infinity` VPH.
- Top-5 selection: sort by `viewsPerHour` descending, take 5; if fewer than 5 posts exist (a very new or low-volume channel), return however many there are — no padding, matching this codebase's established "a short, honest list is correct" pattern from `claude-ideas.ts`.
- `computeDeltas`'s `previous` argument is chosen by the handler (§4): the most recent snapshot for that entry that is at least 7 days old, for a "this week" delta. A second call with a ≥30-day-old snapshot produces the "this month" delta. If no snapshot exists that far back (entry added recently), `previous` is `null` and all deltas are `null` — rendered as "not enough history yet," not zero or an error.

## 4. Handler & refresh orchestration (`lib/watchlist/handler.ts`)

Two entry points, mirroring the shape of `handleStrategyBreakdownRequest`:

```ts
export interface WatchlistHandlerDeps {
  supabase: /* service-role client */;
  youtubeClient: YouTubeClient;
  scraperClient: ScraperClient;
  rateLimitStore: RateLimitStore;
  hasActiveSubscription: (profileId: string) => Promise<boolean>;
  ipSalt: string;
  now?: () => Date;
}

export async function handleAddWatchlistEntry(
  deps: WatchlistHandlerDeps,
  context: { profileId: string | null; ip: string; url: string; label?: string }
): Promise<{ status: number; body: Record<string, unknown> }>;

export async function handleListWatchlist(
  deps: WatchlistHandlerDeps,
  context: { profileId: string | null; ip: string }
): Promise<{ status: number; body: Record<string, unknown> }>;

export async function handleRemoveWatchlistEntry(
  deps: WatchlistHandlerDeps,
  context: { profileId: string | null; entryId: string }
): Promise<{ status: number; body: Record<string, unknown> }>;
```

**`handleAddWatchlistEntry`**: 401 if signed out → 402 if unsubscribed → resolve `url` via `detectHandlePlatform`/`normalizeHandle` (400 if unsupported, same as Strategy Breakdown) → count existing entries for the profile, 400 "You've reached the 20-competitor limit" if already at cap → insert the row (23505 unique-violation on `(profile_id, platform, handle)` mapped to a 409 "You're already tracking this channel," following the existing pattern in `app/api/linkedin/ideas/route.ts`'s `saveIdeas` for handling the same Postgres error code) → return the new entry with no snapshot yet (`hasSnapshot: false` in the response, so the UI can show "fetching first snapshot" without a special-cased null check on the client).

**`handleListWatchlist`**: 401 if signed out (no subscription check here — per decision 3, viewing already-saved entries is sign-in-gated only) → load all entries for the profile → **if `hasActiveSubscription(profileId)` is false, skip refreshing entirely** and return every entry with its last-known snapshot (if any), each `subscriptionRequired: true`, so the UI can show a lightweight "upgrade to keep this refreshed" banner instead of a full-page block → if subscribed, for each entry check its latest snapshot's `captured_at` against `WATCHLIST_SNAPSHOT_TTL_HOURS = 12`; entries with no snapshot, or a snapshot older than the TTL, are candidates for refresh → refresh candidates **up to the remaining daily budget** (see §5), in the order entries were created (oldest-tracked first) → for each entry actually refreshed, fetch via `youtubeClient.getChannelStats` + `getChannelUploads`, or `scraperClient.fetchProfilePosts` (platform-branched, same as Strategy Breakdown), build a `SnapshotSummary`, insert a `watchlist_snapshots` row, clear `last_error`; on a fetch failure, set `last_error` on the entry and continue to the next entry rather than failing the whole request → once refreshing is done (or skipped due to subscription or budget), assemble the response: every entry with its latest snapshot, 7-day delta, and 30-day delta.

**`handleRemoveWatchlistEntry`**: 401 if signed out → delete where `id = entryId and profile_id = profileId` (explicit ownership check in the query, not relying on RLS alone, matching this repo's existing `[id]` DELETE convention) → 404 if nothing was deleted, else 204.

## 5. Rate limiting

New eventType, reusing `checkAndRecordRateLimit` (the atomic check-and-record primitive already used by every rate-limited feature):

```ts
export const WATCHLIST_REFRESH_PROFILE_LIMIT = 40; // per day — covers 20 entries refreshing twice
export const WATCHLIST_REFRESH_IP_LIMIT = 80;       // per day
// eventType: 'watchlist_refresh', windowDays: 1
```

One event is checked-and-recorded **per entry actually refreshed** (not once per page load) — so a page visit that refreshes 3 stale entries consumes 3 of the daily 40, and one that finds everything fresh (within the 12h TTL) consumes 0. When `checkAndRecordRateLimit` returns `allowed: false` partway through refreshing a batch, the handler stops refreshing further entries for that request and serves the rest with their last-known snapshot (and, for entries that have never had a snapshot, `hasSnapshot: false`) — a page visit never fails outright because the daily refresh budget ran out; it just serves what it has. This is a deliberate divergence from every other feature's rate limit, which blocks the whole action with a 429 — here the "action" (viewing the page) must always succeed, and only the background refresh work is throttled.

If a refresh's external fetch throws after the rate-limit event was already recorded, `releaseRateLimitEventIfNeeded` is called (same compensation pattern `strategy/handler.ts` and `recap/handler.ts` already use) — a failed attempt due to an infrastructure error shouldn't burn part of the daily budget; a genuinely-empty-but-successful fetch (e.g. a channel with zero videos) is not released, matching the ideas-route precedent for "honest empty result vs. thrown error."

## 6. Routes & pages

**Routes:**
- `app/api/watchlist/route.ts` — `GET` wires `handleListWatchlist` (the refresh-on-visit entry point), `POST` wires `handleAddWatchlistEntry` (body `{url, label?}`).
- `app/api/watchlist/[id]/route.ts` — `DELETE` wires `handleRemoveWatchlistEntry`.

**Page — `app/watchlist/page.tsx`:**
- Narrower gate than other feature pages, per decision 3's refinement in §4: `needsSignIn` (+ `<SignInPrompt>`) → loaded. There is no full-page `needsUpgrade` block — an unsubscribed signed-in user can still view the (possibly empty) list and any cached snapshots.
- Loaded state: a table, one row per entry — avatar-less (no image fetching in scope) handle/label, subscriber count with a 7d delta badge (e.g. "1.2k (+340 this week)"), total views with its delta, video count, and a "View top posts" expander showing the top-5-by-VPH list (title/caption, view count, VPH, link). Missing follower counts render as "—". A row with `last_error` set shows an inline "couldn't refresh — will retry next visit" note instead of blanking the row. When the list response carries `subscriptionRequired: true`, a dismissible banner reads "Upgrade to keep this watchlist refreshed" (links to `/billing`) — shown above the table, not blocking it.
- An "Add competitor" form (single URL input + optional label field), reusing the same input pattern as `/strategy`'s form. Disabled with a tooltip once 20 entries are reached. Submitting while unsubscribed surfaces the 402 by rendering the existing `<UpgradePrompt title body>` component inline next to the form — it's already a self-contained card (`components/UpgradePrompt.tsx` takes only `title`/`body` props, no full-page assumption baked in), just placed here instead of gating the whole page.
- A "Remove" action per row (confirm, then `DELETE`).
- Landing page (`/`) gets a link to `/watchlist`, same as the other features.

## 7. Error handling

- Adding a channel that can't be resolved (bad URL, `ChannelNotFoundError`) → 400/404 surfaced inline on the add form, entry not created.
- Adding a duplicate `(platform, handle)` → 409, "You're already tracking this channel."
- Adding past the 20-entry cap → 400, cap message, form disabled proactively once the count is known client-side.
- A refresh failing for one entry never fails the page load for the other entries (§4) — this is the single most important error-handling property of this feature, since it's the difference between "one broken competitor entry" and "the whole watchlist is unusable."
- Exhausted daily refresh budget → entries needing refresh simply keep showing their last snapshot; no error surfaced to the user (§5) — this is expected, not a failure state.

## 8. Testing plan

No route tests, per this repo's established convention (routes stay thin wiring; tested via handler unit tests + E2E).

- Unit: `lib/watchlist/aggregate.ts` (`computeViewsPerHour`'s divide-by-zero floor, top-5 ranking and its fewer-than-5 case, `computeDeltas`'s null-when-no-history and null-when-either-side-null cases).
- Unit: `lib/watchlist/handler.ts` for all three entry points, via fakes — extends `tests/fakes/youtube.fake.ts` and `tests/fakes/scraper.fake.ts` to support `getChannelStats`/`followerCount`, and reuses the existing in-memory rate-limit-store fake. Cases: add success, add while unsubscribed (402), add duplicate (409), add at cap (400), add unresolvable URL (400), list while signed out (401), list while unsubscribed with existing entries (200, cached data served, `subscriptionRequired: true`, zero refresh calls made to the fakes), list with all-fresh entries (0 refreshes attempted), list with stale entries within budget (refreshes + saves snapshots), list with stale entries exceeding budget (serves stale data, no error), list where one of several stale entries fails to fetch (`last_error` set on that entry only, others still refresh), remove success, remove someone else's entry (404).
- Unit: `youtube.test.ts` gains `getChannelStats` cases (normal, hidden-subscriber-count, channel-not-found); `scraper.test.ts` gains a `followerCount`-present and `followerCount`-absent case for `fetchProfilePosts`.
- Migration test cases appended to `tests/unit/supabase/migrations.test.ts` for both new tables.
- Page tests for `/watchlist` (sign-in gate, upgrade gate, loaded table with deltas, add form, remove action, 20-cap disables the form).
- E2E: new `tests/e2e/watchlist-smoke.spec.ts` — a subscribed user adds a competitor URL, sees a snapshot appear, expands top posts, removes the entry.
