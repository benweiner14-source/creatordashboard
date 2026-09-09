# LinkedIn Content Strategy Design Spec

**Date:** 2026-09-09
**Classification:** Architectural (per `brainstorming`) — new subsystem (`lib/linkedin/`, three new `lib/integrations/claude-linkedin-*.ts` clients, `app/linkedin/`, `app/api/linkedin/`, three new tables), reusing the existing paid-feature infrastructure pattern.
**Status:** Approved for planning. Decisions below were confirmed via `AskUserQuestion` and in-chat discussion during brainstorming; this doc turns them into an implementable design.

## What this is

A paid feature helping creators build a LinkedIn presence, aimed at doing outreach to partnerships/brand-deal contacts down the line. Per the original brief's framing, the full "LinkedIn presence + outreach" idea was split in two: this feature (content strategy) ships first; a separate outreach/curated-directory feature (reusing the brief's "outreach kit" concept) is deliberately deferred and out of scope here.

Three capabilities, one hub page (`/linkedin`):

1. **A one-time content strategy.** The creator picks a niche and a goal; Claude returns content pillars, a posting-cadence recommendation, and positioning notes. Regenerable — each run is saved, with history.
2. **Recurring post ideas.** Once a strategy exists, a fresh short list of LinkedIn post ideas is generated on demand, once per calendar week, grounded in that strategy's niche and goal.
3. **A profile audit.** The creator exports their own LinkedIn profile as a PDF (browser print-to-PDF — no LinkedIn automation involved) and uploads it; Claude reads it directly and returns what's working and what isn't. The PDF itself is never stored — only the resulting critique text.

## Decisions already made (inputs to this spec, not open questions)

1. **Tier: paid**, gated behind the existing $10/mo subscription (`hasActiveSubscription`) — no separate charge, same as Recap Card / Weekly Content Ideas / Strategy Breakdown.
2. **Persistence: saved and revisitable**, for all three capabilities. Each strategy generation, each week's post ideas, and each audit gets its own row and its own place in a history list.
3. **Why PDF upload, not live scraping, for the profile audit.** The brief (Section 7) names LinkedIn specifically in its exclusion of live scraping for outreach; LinkedIn also has a materially more aggressive anti-scraping enforcement and litigation posture than TikTok/Instagram (e.g. *hiQ Labs v. LinkedIn*), so this holds even for a user's own profile — the risk is the automated-access method, not who owns the data. The creator's own authenticated browser session (Cmd+P / Ctrl+P → save as PDF) does the "access," and Claude's Messages API reads the PDF natively via a `document` content block — no scraping, no new parsing dependency.
4. **The uploaded PDF is never persisted.** It is sent to Claude and discarded; only `headline`/`workingWell`/`needsWork` are saved.
5. **Beginner-first UI for this feature, from the start.** The target user may be 14-18 and have never touched LinkedIn or the corporate world — free-text boxes asking them to invent an answer ("what's your niche," "what's your goal") are the wrong default for this audience. Every place a decision can reasonably be pre-enumerated becomes clickable options with a "something else" free-text escape hatch, not a blank box; unfamiliar terms in results get the same tap-for-a-plain-explanation treatment the rest of the app already uses (`GlossaryChip`/`GlossaryText`); the PDF-export step gets literal numbered instructions, not just a file picker.
6. **This becomes a standing principle going forward**, not just a one-off for this feature — new features default to guided/clickable input over blank free text wherever the answer space can be enumerated. Retrofitting it onto already-shipped free-text inputs elsewhere in the app (concretely: the Ideas page's "niche" box) is explicitly **deferred as a separate, later follow-up** — not part of this build, to keep this spec's scope to the LinkedIn feature itself.

## Non-goals

- No outreach/directory feature, no partnerships-contact database, no DM/message drafting — that is the separate, later feature per the brief's split.
- No live LinkedIn access of any kind (scraping, unofficial API, browser automation) — decision 3 above.
- No storage of the uploaded PDF — decision 4 above.
- No wiring into Weekly Content Ideas or Diagnostic — this is a self-contained feature, same posture as Strategy Breakdown.
- No public share page — this is a personal tool, not something designed to be posted (same reasoning as Strategy Breakdown).
- No retrofit of the Ideas niche box or other existing pages in this build — decision 6 above.

---

## 1. Data model

Three new tables. Same RLS shape used throughout the app since the post-Aug-2026 optimization pass: `(select auth.uid())`, owner-only select/insert, no update/delete policy (service-role-only writes).

```sql
-- Strategy: niche + goal live here, not on `profiles`. A creator's LinkedIn
-- professional niche ("B2B SaaS sales leadership") is a different thing from
-- profiles.niche, which the Ideas feature already uses for TikTok/IG content
-- — conflating them would let one feature's onboarding silently overwrite
-- the other's.
create table if not exists public.linkedin_strategies (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  niche text not null,
  target_goal text not null,
  content_pillars jsonb not null,              -- string[]
  posting_cadence_recommendation text not null,
  positioning_notes text not null,
  headline text not null,
  created_at timestamptz not null default now()
);

alter table public.linkedin_strategies enable row level security;

create policy "LinkedIn strategies are viewable by owner"
  on public.linkedin_strategies for select
  using ((select auth.uid()) = profile_id);

create policy "LinkedIn strategies are insertable by owner"
  on public.linkedin_strategies for insert
  with check ((select auth.uid()) = profile_id);


-- Post ideas: mirrors weekly_digests' shape and unique-per-week constraint.
-- strategy_id grounds each week's ideas in whichever niche/goal was current
-- when they were generated, so old idea-weeks stay meaningful even after
-- the creator regenerates their strategy with a different goal later.
create table if not exists public.linkedin_post_ideas (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  strategy_id uuid not null references public.linkedin_strategies(id) on delete cascade,
  week_start date not null,
  post_ideas jsonb not null,                   -- LinkedInPostIdea[]
  created_at timestamptz not null default now(),
  unique (profile_id, week_start)
);

alter table public.linkedin_post_ideas enable row level security;

create policy "LinkedIn post ideas are viewable by owner"
  on public.linkedin_post_ideas for select
  using ((select auth.uid()) = profile_id);

create policy "LinkedIn post ideas are insertable by owner"
  on public.linkedin_post_ideas for insert
  with check ((select auth.uid()) = profile_id);


-- Profile audits: critique only. No column exists for the PDF itself —
-- deliberately, per decision 4.
create table if not exists public.linkedin_profile_audits (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  headline text not null,
  working_well jsonb not null,                 -- string[]
  needs_work jsonb not null,                   -- string[]
  created_at timestamptz not null default now()
);

alter table public.linkedin_profile_audits enable row level security;

create policy "LinkedIn profile audits are viewable by owner"
  on public.linkedin_profile_audits for select
  using ((select auth.uid()) = profile_id);

create policy "LinkedIn profile audits are insertable by owner"
  on public.linkedin_profile_audits for insert
  with check ((select auth.uid()) = profile_id);
```

`lib/supabase/types.ts` gains `linkedin_strategies` / `linkedin_post_ideas` / `linkedin_profile_audits` Row/Insert/Update entries, same shape convention as the existing tables.

## 2. Claude integration modules

Three new client files, one per capability, following the existing one-client-per-feature convention. All route through `requestClaudeJson` (`lib/integrations/claude-shared.ts`), which needs one small, backward-compatible widening: today `userContent` is typed as `string`; it becomes `string | ClaudeContentBlock[]`, where:

```ts
export type ClaudeContentBlock =
  | { type: 'text'; text: string }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } };
```

The `messages: [{ role: 'user', content: request.userContent }]` line already forwards `userContent` verbatim into the request body, so accepting an array there is a type-level change only — no behavior change for the existing string-only callers (`claude.ts`, `claude-strategy.ts`, and the two new non-PDF LinkedIn clients below).

### `lib/integrations/claude-linkedin-strategy.ts`

```ts
export interface LinkedInStrategyInput {
  niche: string;
  targetGoal: string;
}

export interface GeneratedLinkedInStrategy {
  headline: string;
  contentPillars: string[];
  postingCadenceRecommendation: string;
  positioningNotes: string;
}

export interface LinkedInStrategyClient {
  generateStrategy(input: LinkedInStrategyInput): Promise<GeneratedLinkedInStrategy>;
}

export function createLinkedInStrategyClient(apiKey: string, model = 'claude-sonnet-5'): LinkedInStrategyClient
```

System prompt requirements: written for a reader who may be 14-18 and has never worked a corporate job — explain *why* each recommendation makes sense in terms someone with zero professional-world context would follow (e.g., "brands look at your LinkedIn before agreeing to work with you the way a school might check a reference"), not just state advice. Must explain what a "content pillar" is inline in `positioningNotes` or the surrounding copy, since the UI's glossary treatment (Section 4) covers single terms, not full concepts. Ground cadence advice in realistic creator-adjacent LinkedIn practice (a small number of posts per week, not daily). `niche` and `target_goal` are wrapped in `<niche>`/`<target_goal>` containment tags in the user message — most values come from a fixed button list, but the "something else" escape hatch is free text, so containment applies uniformly rather than conditionally.

### `lib/integrations/claude-linkedin-ideas.ts`

```ts
export interface LinkedInPostIdea {
  workingTitle: string;
  angle: string;
  whyItFitsYourGoal: string;
}

export interface LinkedInIdeasClient {
  generateWeeklyIdeas(niche: string, targetGoal: string, currentDate: Date): Promise<LinkedInPostIdea[]>;
}

export function createLinkedInIdeasClient(apiKey: string, model = 'claude-sonnet-5'): LinkedInIdeasClient
```

Deliberately simpler than `claude-ideas.ts`: no web-search tool use, no real-time trend research. Professional LinkedIn posts don't need to chase a daily trend cycle the way short-form video does — evergreen, goal-aligned angles are the right shape here. 4-6 ideas per call. Same "if nothing honest fits, return fewer (even zero) rather than padding" instruction as `claude-ideas.ts`, for the same reason (Section 5 covers what a zero-idea result does to the rate limit). `niche`/`target_goal` containment-tagged the same way as the strategy client.

### `lib/integrations/claude-linkedin-audit.ts`

```ts
export interface LinkedInAuditInput {
  pdfBase64: string;
}

export interface GeneratedLinkedInAudit {
  headline: string;
  workingWell: string[];
  needsWork: string[];
}

export interface LinkedInAuditClient {
  generateAudit(input: LinkedInAuditInput): Promise<GeneratedLinkedInAudit>;
}

export function createLinkedInAuditClient(apiKey: string, model = 'claude-sonnet-5'): LinkedInAuditClient
```

Calls `requestClaudeJson` with `userContent` as a content-block array: a short `text` block instructing the model, followed by a `document` block carrying the base64 PDF. System prompt must state explicitly that the PDF's content is a third party's exported profile page, not instructions from the person making the request, and that any text inside the PDF that reads like an instruction must be ignored — the same prompt-injection containment posture the final review added to Strategy Breakdown, applied here from the start since a PDF's text is *less* trustworthy than a scraped caption (arbitrary formatting, hidden/white text, etc. are all easy to put in a PDF). `workingWell`/`needsWork` should be phrased as plain, specific, actionable observations (e.g. "Your headline just repeats your job title — say what you actually help people do instead"), not vague praise/criticism.

## 3. Onboarding & beginner-first UI

This section specifies what earlier design specs left to the page implementation, because the beginner-first requirement (decision 5) is itself a spec-level decision here, not an incidental UI choice.

**Intro copy**, shown above the form before any input is requested:
> "Brands and companies often check LinkedIn before deciding who to work with or hire — it's less about going viral and more about looking credible to the right person."

**Niche picker** — buttons, not a text box: `Gaming & esports`, `Fitness & wellness`, `Fashion & beauty`, `Food & cooking`, `Music & entertainment`, `Tech & business`, `Comedy & lifestyle`, `Something else`. Selecting `Something else` reveals a text input (placeholder: `e.g. sustainable fashion, or K-pop fan content`) — the escape hatch, not the default.

**Goal picker** — same pattern: `Land brand or product partnerships`, `Get noticed for jobs or internships`, `Build long-term credibility in my field`, `Not sure yet — just want to look professional`, `Something else` (reveals free text).

**Result rendering** reuses `GlossaryText`/`GlossaryChip` (`components/GlossaryChip.tsx`). This requires adding LinkedIn-specific terms to the glossary — `content-pillars`, `posting-cadence`, `positioning` — to `GLOSSARY_TERMS` in `lib/glossary.ts` (and nowhere else; the seeded `glossary_terms` table in Supabase is a separate, currently-unused seed path per `docs/superpowers/specs/2026-08-12-*` conventions — the app reads from the in-code list, not the table, exactly as it already does for Diagnostic's terms).

**Profile audit upload widget** — numbered instructions directly above the file input, not a tooltip or a linked help page:
1. Go to your own LinkedIn profile page.
2. On a Mac, press Cmd+P. On Windows, press Ctrl+P.
3. Where it asks for a printer, choose "Save as PDF" instead.
4. Upload that file below.

Followed by a reassurance line: "We read it, give you feedback, then delete it — we don't keep a copy of your profile."

## 4. Handlers & routes

Three route groups under `app/api/linkedin/`, following the existing thin-route convention (zero dedicated route tests; behavior covered by handler unit tests + one E2E pass).

**`app/api/linkedin/strategy/route.ts`**
- `GET` — inline in the route (mirrors `app/api/strategy/route.ts`'s `GET` exactly): auth check → `hasActiveSubscription` → most-recent-10 history query (`id, headline, niche, target_goal, created_at`, most-recent-first) → `{ ok: true, latest, history }`, where `latest` is the single most recent full row (content pillars, cadence, positioning) so the hub page can render it without a second round-trip.
- `POST` — delegates to `lib/linkedin/strategy-handler.ts`'s `handleLinkedInStrategyRequest(deps, context)`: auth (401) → subscription (402) → validate `niche`/`targetGoal` are non-empty strings (400) → rate limit → generate → save → return `{ id, strategy }`. Same "validate cheap preconditions before consuming a rate-limit slot" ordering as `lib/ideas/handler.ts`.

**`app/api/linkedin/ideas/route.ts`**
- `GET` — read-only, inline in the route (mirrors `app/api/ideas/route.ts`'s `GET`): auth (401) → subscription (402) → the existing `linkedin_post_ideas` row for `(profile_id, weekStartKey(now))` → `{ ideas }`, or `{ ideas: null }` when this week hasn't been generated yet. No Claude call, no insert, no rate-limit slot — generating is a paid, state-mutating operation and must not be reachable by a cross-site navigation or a link prefetch.
- `POST` — delegates to `lib/linkedin/ideas-handler.ts`'s `handleLinkedInIdeasRequest(deps, context)`, mirroring `lib/ideas/handler.ts`'s `handleIdeasRequest` shape closely: auth → subscription → look up the creator's latest strategy (400 "Build a strategy first" if none exists yet — this capability is meaningless without one) → compute `weekStartKey(now)` (reuse `lib/ideas/handler.ts`'s existing exported helper, not a duplicate) → return the existing row for this week if present (`{ ideas: existing, cached: true }`) → otherwise rate-limit, generate, save, return `{ ideas: saved }`. A genuine zero-idea result does **not** release the rate-limit slot (same rule as `lib/ideas/handler.ts`); a thrown error does.

**`app/api/linkedin/audit/route.ts`**
- `GET` — inline: auth → subscription → most-recent-10 audit history (`id, headline, created_at`).
- `POST` — delegates to `lib/linkedin/audit-handler.ts`'s `handleLinkedInAuditRequest(deps, context)`. Request body is `multipart/form-data` (a real `<input type="file">`, not a base64 JSON blob from the client — no reason to make the browser do that encoding). The route checks auth (401) and subscription (402) *first* — `request.formData()` buffers and parses the whole body, so an unauthenticated caller must not be able to force that allocation — then reads the file via `request.formData()` and validates `file.type === 'application/pdf'` and `file.size <= 4 * 1024 * 1024` (400 otherwise; 4MB, not 10MB, because Vercel Serverless Functions reject a larger body with a non-JSON 413 before the route runs at all) *before* the handler is called — these are the "cheap preconditions" — then the handler does auth/subscription/rate-limit/generate/save on the already-validated, already-base64-encoded PDF string.

All three POST handlers take `hasActiveSubscription`, `rateLimitStore`, `ipSalt`, and their respective Claude client as deps, exactly like `handleStrategyBreakdownRequest`.

## 5. Access control & rate limiting

All three capabilities: signed-in + active subscription required (same $10/mo tier, no additional charge). Uses `checkAndRecordRateLimit`/`releaseRateLimitEventIfNeeded` from `lib/rate-limit.ts` with `profileId` (never `identityHash` — these are always signed-in-only surfaces).

| Capability | `eventType` | Profile limit | IP limit | Window |
|---|---|---|---|---|
| Strategy generation | `linkedin_strategy_generation` | 5 | 10 | 1 day |
| Post ideas generation | `linkedin_ideas_generation` | 5 | 10 | 1 day |
| Profile audit | `linkedin_audit_generation` | 5 | 10 | 1 day |

Same numbers as Strategy Breakdown's `STRATEGY_GENERATION_PROFILE_LIMIT`/`STRATEGY_GENERATION_IP_LIMIT` — no feature-specific reason to diverge. For ideas, the real backstop is the `(profile_id, week_start)` unique constraint (one generation attempt can succeed per week); the rate limit exists to stop retry-hammering within a day, same rationale as the existing Ideas feature. "Zero output after a real attempt still counts" applies to exactly one case: post ideas, where Claude honestly returning no ideas for the given niche/goal is a genuine, completed attempt — the handler returns 422 and does **not** release the slot. Everywhere else, an unusable response is our failure, not the creator's attempt: the strategy and audit clients throw on a degenerate or malformed response (a blank headline, no pillars, no feedback), and throwing goes through `releaseRateLimitEventIfNeeded`, so the slot **is** released and the creator can retry. A thrown/internal error always releases the slot.

## 6. Pages

**`app/linkedin/page.tsx`** — bootstrap-GET-then-render, same top-level shape as `app/strategy/page.tsx`: `loading` → `GET /api/linkedin/strategy` → `needsSignIn` (401) / `requiresUpgrade` (402) / hub view (200). `lib/linkedin/page-state.ts` covers exactly this top-level gate plus the sign-in sub-flow, reusing `isValidEmailFormat`/`SignInPrompt` the same way `lib/strategy/page-state.ts` does — no need to reinvent that state machine.

Once past the gate: no strategy yet → the onboarding form (Section 3). Strategy exists → three sections on one page, each owning its own simple local loading/error state (not folded into the top-level reducer, since they're independent of the auth/subscription gate and of each other):
- The current strategy (headline, pillars, cadence, positioning, with a "Regenerate" action that re-opens the onboarding form pre-filled) plus a collapsed history list below it.
- "This week's post ideas" — its own `useEffect` fetching `GET /api/linkedin/ideas` on mount to read this week's already-generated ideas. When there are none yet (`{ ideas: null }`), it shows a "Get this week's post ideas" button rather than generating on mount; clicking it `POST`s to the same route and renders the result.
- "Profile audit" — the upload widget (Section 3) plus a history list of past audits, fetched from `GET /api/linkedin/audit`.

**Nav & landing page:** `components/AppNav.tsx`'s `NAV_LINKS` gains `{ href: '/linkedin', label: 'LinkedIn' }` (after Strategy, before Billing). `app/page.tsx` gains a landing-page link alongside the existing feature links.

## 7. Testing plan

Same shape as every prior paid feature in this codebase:
- Pure unit tests for all three Claude clients (mocked `fetch`, verifying prompt content and containment tags, verifying the widened `requestClaudeJson` still handles a plain string `userContent` unchanged).
- One handler test file per route (`strategy-handler.test.ts`, `ideas-handler.test.ts`, `audit-handler.test.ts`) covering: no profile (401), no subscription (402), bad input (400 — including non-PDF/oversized file for audit), rate-limited (429), happy path (200), and the release-vs-no-release rate-limit behavior on empty-result vs. thrown-error.
- `lib/linkedin/page-state.test.ts` — reducer tests for the top-level gate + sign-in sub-flow, same coverage shape as `lib/strategy/page-state.test.ts`.
- Page component tests (`app/linkedin/page.test.tsx`) covering: sign-in prompt, upgrade prompt, onboarding form (chip selection incl. "something else" reveal), rendered strategy with a working glossary chip, ideas section, and the audit upload widget's happy path and error path. `vi.mock('@/components/AppNav', () => ({ AppNav: () => null }))`, same as every other page test in this codebase.
- One Playwright smoke test (`tests/e2e/linkedin-smoke.spec.ts`) covering the full loop end to end: onboarding → strategy renders → ideas render → PDF upload → audit critique renders. The PDF upload step needs a real (tiny, fixture) PDF file set on the file input — Playwright's `setInputFiles` handles this without a live network call, since `**/api/linkedin/audit` is mocked at the route level like every other E2E test in this suite.

---

## Self-Review Notes

**Spec coverage:** all three capabilities (strategy, ideas, audit) are covered end to end — data model, generation logic, routes, rate limiting, UI (including the beginner-first requirement that triggered this design pass), and testing.

**Placeholder scan:** no TBD/TODO markers; every interface, table, and route above is concrete enough to plan from.

**Type consistency:** `GeneratedLinkedInStrategy` (Section 2) → persisted as `linkedin_strategies` columns (Section 1) → returned by the `GET`/`POST` strategy routes (Section 4) → rendered via `GlossaryText` (Section 3). `LinkedInPostIdea[]` (Section 2) → `linkedin_post_ideas.post_ideas` (Section 1) → the ideas route (Section 4). `GeneratedLinkedInAudit` (Section 2) → `linkedin_profile_audits` columns (Section 1) → the audit route (Section 4). `ClaudeContentBlock` (Section 2) is additive to `claude-shared.ts` — verified against its current single-string-`userContent` signature, not assumed.

**Verified, not assumed:** `lib/ideas/handler.ts`'s `weekStartKey` is a genuine named export (confirmed by reading the file, not inferred) — Section 4's plan to import and reuse it for the ideas route holds.
