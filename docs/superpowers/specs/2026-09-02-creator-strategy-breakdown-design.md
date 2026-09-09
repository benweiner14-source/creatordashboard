# Creator Strategy Breakdown Design Spec

**Date:** 2026-09-02
**Classification:** Architectural (per `brainstorming`) — new subsystem (`lib/strategy/`, `lib/integrations/claude-strategy.ts`, `app/strategy/`, `app/api/strategy/`, one new table), reusing substantial existing infrastructure.
**Status:** Approved for planning. Decisions below were confirmed via `AskUserQuestion` during brainstorming; this doc turns them into an implementable design.

## What this is

Feature 5 from the original product brief (Section 5): paste a channel/profile link (any of YouTube, TikTok, Instagram) you admire, and get back posting cadence, format mix, and a plain-English "here's what they're actually doing well and why" analysis. The brief frames it as "technically a second mode of the same diagnostic engine... pointed at a whole channel instead of one post, and at someone else's channel instead of your own." That framing is directionally right about *infrastructure reuse* but not about *code structure* — see "Why a new module, not a Diagnostic extension" below.

Directly serves the brief's zero-post/pre-launch segment (Section 2) — someone with nothing of their own to run through Diagnostic can still study channels they admire.

## Decisions already made (inputs to this spec, not open questions)

1. **Tier: paid**, gated behind the $10/mo subscription like Recap Card and Weekly Content Ideas — not free like Diagnostic. It costs real Claude + potential Apify spend per run and targets paid-user behavior (studying channels to plan strategy), not a one-shot free sample.
2. **Persistence: saved and revisitable.** Each generation is stored as its own row with its own id and report page, like Diagnostic — not regenerated fresh every request.
3. **Platform scope: all three (YouTube, TikTok, Instagram) at once.** Both channel-level fetchers already exist from Recap Card (`getChannelUploads`, `fetchProfilePosts`), so there's no meaningful cost saving to launching narrower.
4. **No wiring into Weekly Content Ideas.** The brief notes this feature could "feed the weekly content-ideas feature as inspiration input" — explicitly out of scope for this build. Ships as a self-contained feature; `lib/ideas/` is not touched. The data model (one row per generation, owned by a profile) leaves this open for later without a redesign.
5. **No public share page**, unlike Recap Card — this is a personal research tool, not something designed to be posted. Owner-only RLS, no `/strategy/[id]` public equivalent.

## Why a new module, not a Diagnostic extension

Diagnostic's scoring (`hookStrength`/`retentionRisk`/`timing`/`formatFit`, each a 0–100 score against a benchmarked "ideal") is built to judge *one post*. Cadence and format mix are a different shape of question — "what does this channel actually do across many posts" — with no natural per-dimension score to compute. Forcing this feature through Diagnostic's schema and scoring functions would strain that abstraction rather than reuse it well.

What the brief's "near-zero incremental build" claim actually cashes out to in this codebase is real, substantial reuse at the **infrastructure layer**, all already built for other features:
- `getChannelUploads` (YouTube) and `fetchProfilePosts` (TikTok/Instagram) — both already exist from Recap Card
- `normalizeHandle` — URL/handle parsing, from Recap Card's handle-connection flow
- `checkAndRecordRateLimit` — the same rate-limit infrastructure every paid feature uses
- `computeEngagementRate` — Diagnostic's calibrated, TikTok-comment-weighted engagement formula
- The Claude-client-per-feature convention (`claude.ts`, `claude-ideas.ts`) and the `<SignInPrompt>`/`<UpgradePrompt>` page-state-machine pattern shared by every existing feature page

New code is the channel-level aggregation and its glue — genuinely new logic, not a variant of existing scoring.

## Non-goals

- No modification to `lib/ideas/` or its prompt (decision 4 above).
- No public share page or share URL (decision 5 above).
- No numeric minimum post-count floor before generating — `computeCadence`'s divide-by-zero guard handles the single-post case; Claude's narrative can hedge naturally on thin data the same way Diagnostic does on an unusual post.
- No reuse of `format-fit.ts`'s "ideal range" buckets for format mix — those encode performance judgment (what's good), and this feature describes observed behavior (what a channel actually does). Conflating the two would make an observational stat look like a score it isn't.

---

## 1. Data model

New migration, reusing the existing `diagnostic_platform` enum (`youtube`/`tiktok`/`instagram`) — no new enum needed.

```sql
create table if not exists public.strategy_breakdowns (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  platform public.diagnostic_platform not null,
  channel_handle text not null,
  channel_url text not null,
  post_count integer not null,
  cadence jsonb not null,
  format_mix jsonb not null,
  headline text not null,
  explanation text not null,
  created_at timestamptz not null default now()
);

alter table public.strategy_breakdowns enable row level security;

create policy "Strategy breakdowns are viewable by owner"
  on public.strategy_breakdowns for select
  using (auth.uid() = profile_id);

create policy "Strategy breakdowns are insertable by owner"
  on public.strategy_breakdowns for insert
  with check (auth.uid() = profile_id);
```

Notes:
- **No `status`/`error_message` columns.** `diagnostics` has these in its enum but the app never actually writes a `pending`/`failed` row — on failure, `diagnostic/handler.ts` releases the rate-limit slot and returns an error without saving anything. This table follows the *real* behavior (row written only on success), not the unused aspirational shape.
- **No uniqueness constraint**, unlike `recap_cards`' `(profile_id, month)`. There's no natural "one per channel" key — a user can reasonably re-run the same channel later, or run several different channels. Every generation is its own row.
- `cadence`/`format_mix` are `jsonb`, not flattened columns — nothing here is worth indexing on individually (no 0–100 scores to query/sort by, unlike Diagnostic).

`lib/supabase/types.ts` gets a `strategy_breakdowns` entry mirroring `diagnostics`' Row/Insert/Update shape.

## 2. URL → platform + handle resolution

`lib/recap/handles.ts` gains one new export:

```ts
export function detectHandlePlatform(url: string): RecapPlatform | null
```

Reuses the existing private `HANDLE_HOSTS` map (already covers YouTube, TikTok, Instagram) and the existing suffix-safe `hostMatches` check (guards against `tiktok.com.evil.com`-style spoofing) — no new host-matching logic, no duplicated security-relevant code.

`lib/strategy/handler.ts` calls `detectHandlePlatform(url)` to find the platform, then `normalizeHandle(platform, url)` to extract the handle — the same two-step shape Diagnostic already uses (`youtubeClient.extractVideoId` → `scraperClient.detectPlatform` fallback) for single-post URLs.

**Constraint:** the input must be a full URL. `detectHandlePlatform` needs a hostname to identify the platform, so — unlike Recap's per-platform handle fields, where the platform is already known from which field was filled in and a bare `@handle` is accepted — a bare handle here has nothing to detect platform from. A bare handle fails with the same "not a supported URL" 400 Diagnostic already gives for a bad link. This is a real, accepted UX constraint, not an oversight.

## 3. Fetching & aggregation

**Post volume:** no new cap needed — `getChannelUploads`'s `CHANNEL_UPLOADS_MAX_RESULTS` and `fetchProfilePosts`'s `PROFILE_SCRAPE_RESULTS_LIMIT` both already cap at 50 most-recent posts.

**`ProfilePost` gains `durationSeconds`.** Today only single-post `fetchPost` (`SocialPostMetadata`) returns duration; `fetchProfilePosts`'s `ProfilePost` doesn't. Format mix needs duration for TikTok/Instagram posts, so `ProfilePost` and `normalizeProfilePost` in `lib/integrations/scraper.ts` are extended to include it, sourced the same way `fetchPost` already gets it from the Apify response (`item.videoDuration ?? item.duration ?? 0`). This is a small, targeted addition to existing code — Recap Card's own aggregation doesn't use duration and is unaffected.

**Common post shape** (`lib/strategy/types.ts`):

```ts
export interface ChannelPost {
  captionOrTitle: string;
  publishedAt: string;
  durationSeconds: number;
  viewCount: number;
  likeCount: number;
  commentCount: number;
}
```

YouTube's `VideoMetadata` and the (now duration-bearing) `ProfilePost` both map into this shape in `lib/strategy/handler.ts`.

**Cadence** (`computeCadence(posts: ChannelPost[]): CadenceSummary`, pure function in `lib/strategy/aggregate.ts`):

```ts
export interface CadenceSummary {
  postCount: number;
  spanDays: number;                    // oldest → newest post in the fetched set
  postsPerWeek: number;                // postCount / (spanDays / 7); falls back to postCount if spanDays < 1
  mostCommonDayOfWeek: string | null;  // e.g. "Tuesday"; null only if postCount === 0
}
```

A day-of-week tie is broken by whichever day appears first when iterating the fetched posts in the order returned by the fetcher (both `getChannelUploads` and `fetchProfilePosts` return most-recent-first, so a tie favors the more recently-established pattern) — deterministic, not a meaningful product decision either way.

**Format mix** (`computeFormatMix(posts: ChannelPost[]): FormatMixSummary`, pure function):

```ts
export interface FormatMixSummary {
  averageDurationSeconds: number;
  shortPct: number;   // <=60s
  mediumPct: number;  // 60-240s
  longPct: number;    // >240s
}
```

Flat, platform-neutral buckets — deliberately not `format-fit.ts`'s "ideal range" semantics (see Non-goals).

**Average engagement rate:** `computeAverageEngagementRate(platform, posts): number` in `lib/strategy/aggregate.ts` — the mean of `computeEngagementRate` (imported from `lib/diagnostic/types.ts`, the existing TikTok-comment-weighted formula) across the fetched posts, not total-likes-over-total-views, so one viral outlier doesn't dominate the picture.

## 4. Claude glue

New `lib/integrations/claude-strategy.ts`, following the one-client-per-feature convention (`claude.ts` for Diagnostic, `claude-ideas.ts` for Weekly Content Ideas):

```ts
export interface StrategyBreakdownInput {
  platform: 'youtube' | 'tiktok' | 'instagram';
  channelHandle: string;
  cadence: CadenceSummary;
  formatMix: FormatMixSummary;
  averageEngagementRate: number;
  topPosts: Array<{ captionOrTitle: string; viewCount: number }>; // top 3 by views
}

export interface GeneratedStrategyBreakdown {
  headline: string;
  explanation: string;
}

export interface StrategyBreakdownClient {
  generateStrategyBreakdown(input: StrategyBreakdownInput): Promise<GeneratedStrategyBreakdown>;
}

export function createClaudeStrategyClient(apiKey: string, model = 'claude-sonnet-5'): StrategyBreakdownClient;
```

A `STRATEGY_BREAKDOWN_SYSTEM_PROMPT` constant is exported alongside these, its literal text authored during implementation (same as every other feature's system prompt) — its required content is fully specified in prose below, not left open.

- **Top 3 posts by view count** are included as concrete examples ("your videos under a minute, like X, are massively outperforming your longer ones") so the narrative can point at specifics, not just abstract stats — matches the brief's "here's what they're actually doing well and *why*" framing.
- **System prompt** follows `DIAGNOSTIC_SYSTEM_PROMPT`'s shape: plain English for a 16–24 y/o beginner, must explain *why* (not just describe), grounded in the same per-platform algorithm-behavior framing already written for Diagnostic (finishing-video signal for TikTok, watch-time/shares for Instagram, 8-minute mark for YouTube) — reused as context verbatim, not rewritten, since it describes the same underlying platform behavior.
- Response shape: `{ headline, explanation }`, same JSON-response convention as `claude.ts`/`claude-ideas.ts`.

## 5. Access control & rate limiting

`lib/strategy/handler.ts` follows `handleIdeasRequest`'s exact gating order:

```ts
if (!context.profileId) return { status: 401, body: { error: '...' } };
if (!(await deps.hasActiveSubscription(context.profileId))) {
  return { status: 402, body: { error: 'Creator Strategy Breakdown requires an active subscription.', upgradeUrl: '/billing' } };
}
// then rate limit, then resolve URL → fetch → aggregate → generate → save
```

Rate limiting reuses `checkAndRecordRateLimit`, matching Recap/Ideas' constants exactly:

```ts
export const STRATEGY_GENERATION_PROFILE_LIMIT = 5; // per day
export const STRATEGY_GENERATION_IP_LIMIT = 10;      // per day
// eventType: 'strategy_breakdown_generation', windowDays: 1
```

## 6. Routes & pages

**Routes:**
- `POST /api/strategy` — wires real deps into `handleStrategyBreakdownRequest`, mirrors `/api/ideas/route.ts`
- `GET /api/strategy/[id]` — RLS-scoped fetch via the regular cookie-scoped Supabase client (ownership enforced by RLS, no manual check needed), mirrors `/api/diagnostic/[id]/route.ts`

**Pages:**
- `/strategy` (input) — same state-machine shape as every other feature page: `needsSignIn` (+ magic-link sub-states, `<SignInPrompt>`) → `needsUpgrade` (`<UpgradePrompt title="..." body="..."/>`, reused unchanged) → idle form (single URL field) → submitting → success `router.push('/strategy/[id]')`; 400/429/500 render inline errors.
- `/strategy/[id]` (report) — headline + `<GlossaryText>`-wrapped explanation (this is a beginner-explanation surface, same as Diagnostic's report page, so it gets glossary-linking too), a stats section (posts/week, most common day, short/medium/long % mix), and the top 3 referenced posts with view counts.
- Landing page (`/`) gets a link to `/strategy`, same as the other three features.

## 7. Error handling

- 0 posts returned for a channel → explicit "That channel doesn't have any public posts we could analyze" error, not a nonsensical empty breakdown.
- 1+ posts → no arbitrary minimum floor (see Non-goals).
- Fetch failures, Claude parse failures, rate-limit release-on-failure → same handling already established in `diagnostic/handler.ts` and `claude.ts`/`claude-ideas.ts`.

## 8. Testing plan

No route tests, per this repo's convention (routes stay thin wiring; tested via handler unit tests + E2E).

- Unit: `lib/strategy/aggregate.ts` (cadence, format mix, engagement-rate averaging), `lib/strategy/handler.ts` (via fakes, mirroring `ideas/handler.test.ts`), `lib/integrations/claude-strategy.ts` (mocked `fetch`, mirroring `claude.ts`'s tests), `detectHandlePlatform` added to `recap/handles.test.ts`, `ProfilePost`'s new `durationSeconds` field added to `scraper.test.ts`.
- Migration test case appended to `tests/unit/supabase/migrations.test.ts`.
- Page tests for `/strategy` and `/strategy/[id]`, mirroring `/ideas/page.test.tsx` and `/diagnostic/[id]/page.test.tsx`.
- E2E: new `tests/e2e/strategy-smoke.spec.ts` — signed-out visitor sees a sign-in prompt; a subscribed user pastes a channel URL and sees a rendered breakdown. Not adding a case to `billing-smoke.spec.ts` — that file doesn't carry per-feature paywall coverage for every feature already (no `/ideas` case either), so this follows that existing precedent rather than introducing a new one.
