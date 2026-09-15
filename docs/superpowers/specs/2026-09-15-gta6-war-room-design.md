# GTA6 War Room Design Spec

**Date:** 2026-09-15
**Classification:** Architectural — new subsystem (`lib/warroom/`, two new tables, `app/warroom/`, `app/api/warroom/`, `app/api/cron/warroom/`). Reuses existing infrastructure (the Apify-over-HTTP calling pattern, the two-call YouTube API convention, Resend email, the cron-auth pattern, subscription gating) but introduces genuinely new capabilities: platform-wide hashtag/keyword discovery, scheduled background scraping, and virality scoring.
**Status:** Approved for planning. Decisions below were confirmed via `AskUserQuestion` during brainstorming; this doc turns them into an implementable design.

## What this is

A native, GTA6-only real-time content-opportunity feed for Creator Dashboard, modeled on a pre-existing personal n8n system ("Social War Room") the founder built to monitor NBA 2K/Ronnie2K social virality for a brand's social team. This rebuilds the same scrape → score → alert pattern natively inside this app — not by depending on or reusing the external n8n instance — retargeted at the whole GTA6 topic instead of one brand, and reframed from "notify a brand's Slack channel" to "surface a creator's own next content opportunity." It's a candidate anchor/flagship feature for the next phase of the GTA6-niche pivot: the 4 existing core features (Content Ideas, Recap Card, Strategy Breakdown, Competitor Watchlist) are all weekly or on-demand; this is the product's first real-time surface.

## Decisions already made (inputs to this spec, not open questions)

1. **Detection mechanism: real per-platform discovery + numeric virality thresholds**, not a Claude-web-search proxy — matching the reference system's mechanism and precision rather than a cheaper approximation.
2. **Platforms: YouTube, TikTok, Instagram.** Twitter/X is explicitly out of scope — it isn't integrated anywhere in this codebase, and none of the reference system's Twitter-specific logic (its RT-filter, its tweet normalization, its engagement-based thresholds) is ported.
3. **Cadence & budget: hourly scans**, not the reference's every-10-minutes — starting at a fraction of the reference's ~$150-200/mo single-brand Apify spend, with room to tighten later once real cost/usage data exists.
4. **Feed shape: one shared, global feed.** Every subscriber sees every alert; there is no per-subscriber filtering by their own GTA6 sub-focus (the field Content Ideas added). The underlying scrape/scoring is shared regardless, so this is purely a display decision.
5. **Delivery: in-app feed (always) + opt-in email**, and only for **Going Viral**/**Already Viral** tiers — **Heating Up** is feed-only, to keep opt-in email volume sane.
6. **Content Ideas link: a link, not a trigger.** Each alert has a "Generate an idea from this" link into `/ideas`, carrying the alert's caption as context. Nothing generates automatically.
7. **Gating: subscription-gated like Recap/Strategy/Ideas**, not Watchlist's sign-in-only-view pattern — sign-in AND an active subscription are both required to view `/warroom`.
8. **Reactivation after an Apify-budget pause: manual for v1.** No equivalent of the reference system's separate hourly "Credit Monitor" auto-reactivation workflow.
9. **Scope cut vs. the reference system: no curated "big account" profile-scraping tier.** The reference runs two parallel discovery modes — broad hashtag/keyword search, and separately scraping a curated list of ~60-70 known team/media accounts' profiles directly (with looser thresholds for those accounts). This build does hashtag/keyword discovery only; the "big account" threshold tier and its curated handle lists don't apply here.

## Why this needs new integration work, not reuse

Every existing platform integration in this codebase (`lib/integrations/youtube.ts`, `lib/integrations/scraper.ts`) is scoped to a *known* channel, profile, or post — Recap Card, Strategy Breakdown, and Watchlist all operate on a handle the user already supplied. War Room needs the opposite capability: discovering *unknown* new posts by hashtag/keyword across an entire platform, right now. That's genuinely new integration work on all three chosen platforms, and it's the single biggest technical departure this feature makes from the rest of the app.

The good news: a real, production-tested reference implementation exists — the n8n workflow this spec is derived from (`Social War Room (Slack)`, live since before 2026-08-14). This design ports its proven Apify actor calls, normalization field-mappings, threshold math, and budget/health-check logic directly rather than re-deriving them from scratch. Where this spec departs from that reference, it says so explicitly and why.

## Non-goals

- **No Twitter/X integration** (decision 2).
- **No curated "big account" profile-scraping tier** (decision 9) — hashtag/keyword discovery only. A future fast-follow could add one, mirroring Watchlist's suggested-creator seed list, but it's not part of this build.
- **No per-subscriber feed personalization** by GTA6 sub-focus (decision 4) — a v2 candidate.
- **No automatic Content Ideas generation** from an alert (decision 6) — a link, not a trigger.
- **No auto-reactivation** after a budget pause (decision 8) — manual only.
- **No real-time push/websockets/SSE.** Fetch-on-load, same as every other page in this app.
- **Not a replacement for Competitor Watchlist.** Watchlist tracks specific *known* competitor channels over time; War Room discovers *unknown* trending posts by topic. They're complementary, not overlapping — a future fast-follow could cross-link them (e.g., "this trending post is from a channel you're already watching"), but that's out of scope here.

---

## 1. Data model

New migration `supabase/migrations/20260915000001_create_warroom_tables.sql`, reusing the existing `diagnostic_platform` enum:

```sql
create table public.warroom_alerts (
  id uuid primary key default gen_random_uuid(),
  platform public.diagnostic_platform not null,
  external_post_id text not null,
  url text not null,
  caption_or_title text not null,
  view_count integer not null,
  engagement_count integer not null,
  published_at timestamptz not null,
  severity text not null check (severity in ('heating_up', 'going_viral', 'already_viral')),
  detected_at timestamptz not null default now(),
  unique (platform, external_post_id)
);

alter table public.warroom_alerts enable row level security;
-- CORRECTED post-implementation (final whole-branch review): no select
-- policy for regular users. The predicate below only checked sign-in, not
-- subscription, despite its own name — a real paywall bypass, since
-- GET /api/warroom already exclusively reads this table through the
-- service-role client and gates on subscription in the handler. Do not
-- reintroduce this policy:
--   create policy "War Room alerts are viewable by any signed-in subscriber"
--     on public.warroom_alerts for select
--     using ((select auth.uid()) is not null);

create index warroom_alerts_detected_at_idx
  on public.warroom_alerts (detected_at desc);

create table public.warroom_settings (
  id boolean primary key default true check (id),  -- singleton row pattern
  paused boolean not null default false,
  paused_reason text,
  paused_at timestamptz
);

insert into public.warroom_settings (id) values (true);

alter table public.warroom_settings enable row level security;
-- No select/insert/update policy for regular users at all: this table is
-- operational state, read and written only by the service-role client (the
-- cron route and the manual-reactivation admin route). RLS enabled with zero
-- policies means every non-service-role query is denied by default.
```

Notes:

- **No per-user rows anywhere** — `warroom_alerts` is a single shared feed, per decision 4. The `select` policy only checks that the viewer is signed in; it does not scope rows by `profile_id` (there is no `profile_id` column). Subscription-gating happens in the handler (§7), same as every other feature — RLS here only prevents a signed-out request from reading the table directly.
- **`unique (platform, external_post_id)`** is the entire dedup mechanism — permanent, not the reference system's rolling 24h window. Once a specific post has ever alerted, it never alerts again, even if it's still growing. This is a deliberate simplification: a creator doesn't need repeat notification about a post they already know about (§4 covers how inserts rely on this constraint rather than a separate pre-check query).
- **`engagement_count`** is a platform-specific sum computed at normalize time (§3): TikTok = likes+comments+shares; Instagram = likes+comments; YouTube = likes+comments. It exists so scoring logic doesn't need to know per-platform field names.
- **`warroom_settings`** is a singleton (`id boolean primary key default true check (id)` permits exactly one row, id=true) — the same pattern this fixes on a value rather than an identity column, since there's genuinely only ever one row. The cron route reads it first (§4). Manual reactivation (decision 8) is a direct `update warroom_settings set paused = false` run via the Supabase SQL editor/dashboard — no admin route or UI is built for this, deliberately: it's meant to be rare (only after confirming in the Apify dashboard that usage has actually reset), and a one-off SQL statement is simpler and has less surface area than building and securing a whole admin-auth code path for it.

`lib/supabase/types.ts` gains `warroom_alerts` and `warroom_settings` Row/Insert/Update entries.

## 2. Discovery clients (`lib/warroom/discovery/`)

Three new files, one per platform, each exporting a single discovery function — kept separate from `lib/integrations/youtube.ts` and `lib/integrations/scraper.ts` rather than added to those interfaces, since "search the whole platform by keyword" is a categorically different capability from "fetch a known channel's posts," and mixing them would blur both interfaces' contracts.

**Common normalized shape**, matching `warroom_alerts`' columns:

```ts
export interface DiscoveredPost {
  platform: 'youtube' | 'tiktok' | 'instagram';
  externalPostId: string;
  url: string;
  captionOrTitle: string;
  viewCount: number;
  engagementCount: number;
  publishedAt: string; // ISO 8601
}
```

**`lib/warroom/discovery/youtube.ts`** — `searchGta6Videos(apiKey: string, publishedAfter: Date): Promise<DiscoveredPost[]>`. Two calls, mirroring the existing `getChannelUploads`/`getChannelStats` two-call convention:
1. `search.list` with `q="GTA 6" OR "GTA VI" OR "Grand Theft Auto 6"`, `type=video`, `order=date`, `publishedAfter=<ISO 8601>`, `part=id` — 100 quota units per call.
2. `videos.list` with the returned video IDs, `part=snippet,statistics` — 1 unit per call — to get `viewCount`/`likeCount`/`commentCount`.

At hourly cadence with 2-3 distinct keyword queries per run, this is ~48-72 search calls/day (4,800-7,200 quota units), comfortably under the default 10,000-unit daily quota — no quota-increase request needed to start, unlike Apify's budget situation.

**`lib/warroom/discovery/tiktok.ts`** — `searchGta6TikToks(apifyToken: string): Promise<RawTikTokItem[]>`. `POST https://api.apify.com/v2/acts/clockworks~tiktok-scraper/run-sync-get-dataset-items` with query params `token`/`maxItems`/`timeout` and a JSON body `{"hashtags": ["gta6", "gta 6", "grandtheftauto6", "gtavi"], "searchQueries": ["GTA 6", "GTA VI", "Grand Theft Auto 6"], "maxItems": 30, "shouldDownloadVideos": false, "shouldDownloadCovers": false, "publishTime": "LAST_24H"}` — same actor and call shape as the reference, GTA6 keywords substituted for NBA2K's.

**`lib/warroom/discovery/instagram.ts`** — `searchGta6InstagramPosts(apifyToken: string): Promise<RawInstagramItem[]>`. `POST https://api.apify.com/v2/acts/apify~instagram-hashtag-scraper/run-sync-get-dataset-items`, body `{"hashtags": ["gta6", "gtavi", "grandtheftauto6"], "resultsLimit": 50, "searchType": "hashtag"}` — same actor as the reference.

Each of these three raw-result types gets a `normalize*` function (`normalizeTikTokPost`, `normalizeInstagramPost`, alongside YouTube's stats mapping) producing `DiscoveredPost[]`, reusing the reference's real field names directly:

- **TikTok**: `playCount`→viewCount, `diggCount`+`commentCount`+`shareCount`→engagementCount, `id`→externalPostId, `webVideoUrl`→url, `text`→captionOrTitle, `createTime` (unix seconds)→publishedAt.
- **Instagram**: `likesCount`+`commentsCount`→engagementCount, `videoViewCount`ǁ`viewsCount`→viewCount, `shortCode`→externalPostId, `url`→url, `caption`→captionOrTitle, `timestamp`ǁ`takenAtTimestamp`→publishedAt.

Both reuse the reference's benign-vs-real-error distinction directly in their error handling: an Apify dataset item shaped as `{error: 'not_found' | 'no_items' | 'restricted_page'}` is skipped, not treated as a failure (§4 covers actual failures).

**Existing env var reuse**: both Apify calls use `process.env.APIFY_API_TOKEN`, the same variable `createApifyScraperClient` already reads for Recap Card/Strategy Breakdown — no new secret to configure. This does mean War Room's Apify spend lands on the same Apify account/bill as the existing scraper usage; §9 covers cost implications.

## 3. Scoring (`lib/warroom/scoring.ts`)

Pure function per post: `classifySeverity(post: DiscoveredPost, now: Date): 'heating_up' | 'going_viral' | 'already_viral' | null`. Thresholds, adapted from the reference's proven **Standard** tier (the only tier that applies — decision 9 cuts the "big account" tier):

| Platform | Heating Up | Going Viral | Already Viral |
|---|---|---|---|
| TikTok | views≥100K or eng≥2K, age≤240min | views≥300K or eng≥8K, age≤180min | views≥1M or eng≥20K (no age limit) |
| Instagram | eng≥2,500, age≤180min | eng≥6,000, age≤120min | eng≥15,000 (no age limit) |
| YouTube (new) | viewsPerHour≥500, age<24h | viewsPerHour≥2,000, age<12h | viewsPerHour≥5,000 or views≥200K (no age limit) |

TikTok and Instagram numbers are the reference system's real, tuned "Standard" thresholds, unchanged. YouTube has no reference precedent (the original system never covered YouTube) — these are new, designed using `computeViewsPerHour` from `lib/metrics.ts`, the same shared function Watchlist/Recap/Strategy already use for exactly this "reward a post that's accelerating, not just old-and-accumulated" purpose. All numbers here are explicitly starting points, not derived from real usage — consistent with the reference doc's own admission that its thresholds have been retuned multiple times since launch (§7 of the reference handoff doc).

A post older than 48 hours is dropped before scoring, full stop, regardless of tier — this runs first, ahead of everything in the table above. "(no age limit)" in the table means that tier's numeric threshold carries no *additional* age condition beyond that universal 48h cutoff — an Already Viral-magnitude post discovered 3 days after publishing is still dropped by the 48h rule; it does not mean that tier is literally unbounded in age.

## 4. Cron orchestration (`app/api/cron/warroom/route.ts` + `lib/warroom/cron-handler.ts`)

Hourly (`vercel.json`: `{"crons": [{"path": "/api/cron/warroom", "schedule": "0 * * * *"}]}`), same `CRON_SECRET` bearer-auth pattern the removed weekly-digest cron used. `export const maxDuration = 300`, same as that cron's Vercel route-segment maximum.

A pure `runWarroomCron(deps, now)` handler, same injected-deps shape as `runWeeklyDigestCron`, so the whole sequence is unit-testable without touching a real Supabase/Apify/YouTube call:

1. **Pause check** — read `warroom_settings`; if `paused`, return immediately (no scraping attempted).
2. **Daily cap check** — `select count(*) from warroom_alerts where detected_at >= <start of today>`; if ≥ `WARROOM_DAILY_ALERT_CAP = 30` (tunable), return immediately. Mirrors the reference's `Cap Reached?` gate, as a query instead of a Sheets read.
3. **Parallel discovery** — `Promise.allSettled([discoverYoutube(), discoverTikTok(), discoverInstagram()])`. This replaces the reference's 14-input `Merge` node entirely: in real code, "merge the branches" is just collecting settled results, with no separate merge step. One platform's rejection doesn't affect the others' results.
4. **Health check** — inspect the settled results' errors (both rejected promises and any Apify-dataset-level error items) for the budget-exhaustion pattern, reusing the reference's regex verbatim: `/hard limit exceeded|platform-feature-disabled|monthly usage/i`. On a match: `update warroom_settings set paused = true, paused_reason = ..., paused_at = now()`, send one operator email via the existing Resend integration (`lib/integrations/resend.ts`, already wired for the old weekly digest) to a new `WARROOM_OPERATOR_EMAIL` env var, and stop the run — there is no Slack channel in this product, so email is the operator-alert channel. A non-budget failure (a single actor erroring) is logged (`console.error`, visible in Vercel's function logs) and the run continues with whatever platforms succeeded — not worth paging over one bad scrape.
5. **Normalize + score** — successful results run through §2's normalize functions, then §3's `classifySeverity`; anything scoring `null` (or older than 48h) is dropped.
6. **Per-run cap + insert** — the surviving posts are capped to the top 5 per run (by severity, then by view/engagement count — mirrors the reference's `results.slice(0, 5)`, preventing one run from dumping dozens of alerts at once even on a day GTA6 news is unusually heavy), deduplicated in-memory within this run's own results, then each is inserted via `insert into warroom_alerts (...) values (...) on conflict (platform, external_post_id) do nothing` — Postgres handles cross-run dedup atomically; no separate "seen ids" query needed.
7. **Opt-in email fan-out** — for each alert actually inserted (a real `on conflict` no-op doesn't re-trigger this) with severity `going_viral` or `already_viral`, send an email via Resend to every profile with `warroom_email_opt_in = true` (§6). `heating_up` alerts never email, per decision 5.

## 5. Content Ideas link

`/warroom`'s "Generate an idea from this" link navigates to `/ideas?context=<url-encoded caption>`. `app/ideas/page.tsx`'s bootstrap reads that query param (client-side, `useSearchParams`) and, if present, passes it through as a new optional field on the existing `POST /api/ideas` call. `lib/ideas/handler.ts`'s `handleIdeasRequest` gains one new optional context field on its request shape, threaded into the Claude prompt as an additional "the creator is starting from this specific moment" line — additive to the existing niche-based prompt, not a replacement for it. No change to the generation's core niche/date inputs, its rate-limiting, or its response shape.

## 6. Email opt-in

New `warroom_email_opt_in boolean not null default false` column on `profiles` (same shape as the removed `digest_email_opt_in` column was). New `POST /api/warroom/opt-in` route + `handleWarroomOptIn` handler (401 if signed out, else update the column) — structurally similar to the old digest opt-in handler but not shared code, since that handler no longer exists and this is its own feature's setting. The checkbox lives on `/warroom` itself, not on `/ideas` — it's this feature's own delivery preference, unrelated to Content Ideas' weekly generation.

## 7. Routes & pages

**Routes:**
- `app/api/warroom/route.ts` — `GET`: 401 if signed out, 402 if unsubscribed (`hasActiveSubscription`), else the shared feed — `select * from warroom_alerts order by detected_at desc limit 100`.
- `app/api/warroom/opt-in/route.ts` — `POST`, per §6.
- `app/api/cron/warroom/route.ts` — `GET`, cron-secret-authenticated, per §4.

**Page — `app/warroom/page.tsx`:** Gated like Recap/Strategy/Ideas (`needsSignIn` → `requiresUpgrade` → loaded), not Watchlist's narrower sign-in-only gate — per decision 7. Loaded state:
- A feed of alert cards, newest first: platform badge, severity badge (🔥 Heating Up / 🚀 Going Viral / 💥 Already Viral — same tier language and color association as the reference's Slack messages), truncated caption/title, view/engagement stats, time-since-posted, a link to the original post, and the "Generate an idea from this" link (§5).
- An email opt-in checkbox ("Email me when something crosses Going Viral") wired to `POST /api/warroom/opt-in` (§6).
- Empty state: "No GTA 6 alerts yet — check back soon" (the feed starts empty; alerts accumulate as the cron runs).
- No polling/auto-refresh — fetch-on-load, consistent with every other page in this app.

`components/AppNav.tsx` gains a `/warroom` link, placed right after Home — this is meant as the flagship surface, not a footnote. `app/page.tsx` (marketing landing) gains a corresponding link, matching the other 4 features' treatment there.

## 8. Error handling

- Bootstrap fetch failure on `/warroom` → the same `bootstrapError`-alert pattern already used on `/watchlist` and `/ideas`, not a blank page.
- A single platform's discovery failing during a cron run never blocks the other platforms or fails the run (§4 step 3-4) — same "one bad input doesn't break the whole feature" property Recap Card's per-platform handling already establishes.
- Apify budget exhaustion pauses cleanly (§4 step 4) rather than retrying and re-alerting every hour — the exact failure mode the reference system's real incident (§7 of the handoff doc: a 2-day Slack-spam incident) exists to prevent.
- A duplicate post (same `platform`+`external_post_id` re-discovered on a later run, e.g. still trending) silently no-ops on insert — not an error, just dedup working as designed.
- Content Ideas generation triggered from a War Room link fails exactly the same way a normal `/ideas` generation failure does today (same handler, same error surface) — no special-cased error path for the linked flow.

## 9. Operational notes

- **Cost**: hourly cadence × 3 platforms is the starting budget; the reference system's ~$150-200/mo was for one brand at ~8x this cadence, so a rough (not promised) starting expectation is a fraction of that per platform — real cost will only be known once this runs against real GTA6 hashtag/keyword volume, which is unknown in advance. Apify spend shares the same account/bill as the existing Recap Card/Strategy Breakdown scraper usage (§2) — worth watching combined usage, not just War Room's share of it, against whatever cap is set on that Apify account.
- **YouTube quota**: no increase needed to start (§2's math) — revisit if keyword query count grows.
- **No secrets duplicated from the reference system.** The reference n8n workflow's live Apify token and n8n-API credential are specific to that separate, personal instance and are not reused, referenced, or copied anywhere in this implementation — this build uses this app's own `APIFY_API_TOKEN` and `RESEND_API_KEY` env vars, already configured for existing features, plus one new one: `WARROOM_OPERATOR_EMAIL` (§4), the address that receives the budget-exhaustion pause notice.
- **Threshold tuning is expected.** Per the reference system's own multi-month tuning history, the numbers in §3 should be treated as a starting hypothesis, checked against real alert volume/quality within the first few weeks, and adjusted — the same way the reference system tightened its own TikTok "Heating Up" rule in 2026-06 after a false-positive leaked through.

## 10. Testing plan

- **`lib/warroom/scoring.ts`** — unit tests per platform/tier boundary (at-threshold, just-under, age-window edges), same RED→GREEN style as `lib/metrics.ts`'s existing tests.
- **`lib/warroom/discovery/*.ts`** normalize functions — unit tests against fixture JSON shaped like real Apify actor output (per §2's real field names) and real YouTube API responses, including the benign-error-item skip cases (`not_found`/`no_items`/`restricted_page`).
- **`lib/warroom/cron-handler.ts`** — unit tests via injected fakes, covering: pause short-circuit, daily-cap short-circuit, one platform's discovery rejecting doesn't block the others, budget-exhaustion regex match → pause + exactly one operator email, a repeat `external_post_id` doesn't re-insert or re-email, the 5-per-run cap, and that only `going_viral`/`already_viral` (not `heating_up`) trigger opt-in emails.
- **`lib/ideas/handler.ts`** — one new test case for the optional context field passing through to the prompt, alongside its existing cases.
- **`/warroom` page** — bootstrap gating (signed-out/unsubscribed/loaded), feed rendering, severity/platform badges, the Content-Ideas link's `?context=` construction, opt-in checkbox toggling.
- **E2E**: new `tests/e2e/warroom-smoke.spec.ts` — a subscribed user visits `/warroom`, sees a mocked alert, follows the "generate an idea" link into a pre-filled `/ideas`.
- Every external call (Apify, YouTube, Resend) is mocked in tests — no real network dependencies, consistent with the rest of this codebase's testing conventions.
