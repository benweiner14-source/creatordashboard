# Weekly Content Ideas Design Spec

**Date:** 2026-08-13
**Classification:** Architectural (per `brainstorming`) — new subsystem (`lib/integrations/claude-ideas.ts`, `lib/ideas/`, `app/ideas/`, `app/api/ideas/`, reuse of two already-scaffolded-but-unused `profiles.niche`/`weekly_digests` schema pieces).
**Status:** Approved for planning. Decisions below were confirmed via `AskUserQuestion` during brainstorming; this doc turns them into an implementable design.

## What this is

A weekly, on-demand digest of ~6–8 ranked short-form content concepts (Reels/TikTok + Instagram carousels) for a creator's niche — the third V1 feature from the original product brief, alongside Diagnostic and Recap Card (both already shipped). Adapted from the reference `ronnie2k-content-ideas` skill (`docs/reference/creator-dashboard-source-skills-export.md` §1) — that skill is written for one specific creator's brand (NBA/NBA 2K content, hard brand guardrails like "no gambling language," "MyPLAYER never avatar"), invoked ad hoc inside Claude Code with live `WebSearch`. This feature generalizes the skill's genuinely reusable content-strategy IP (the two format libraries, the ranking model, the carousel construction rules) into a niche-agnostic backend feature, sourced via Anthropic's server-side `web_search` tool rather than a Claude-Code-specific tool.

## Decisions already made (inputs to this spec, not open questions)

1. **Sourcing: Claude's `web_search` server tool**, not a separate scraping/curated-source pipeline. Confirmed against the tool's actual current shape (`type: "web_search_20260209"`, `name: "web_search"`, `max_uses`/`allowed_domains`/`blocked_domains`/`user_location` params, `web_search_tool_result` response blocks, citations attach automatically) rather than assumed from training-data memory. Unlike Recap Card's Apify integration, **the research loop runs entirely server-side** — the model calls `web_search` autonomously (up to a capped `max_uses`) within a single synchronous `POST /v1/messages`, so no async run-then-poll machinery is needed on our end.
2. **Trigger: on-demand only**, mirroring Recap Card exactly. A "Get this week's ideas" button, never a scheduled sweep across creators. One `weekly_digests` row per `(profile, week_start)` is the cache — a second request in the same week returns the existing row without re-generating.
3. **Niche capture: a free-text field on this feature's own page (`/ideas`)**, first-visit self-service, same pattern as Recap Card's handle-connection step. `profiles.niche` already exists in the schema (from the scaffold plan) but nothing sets it today — this feature becomes the thing that finally populates it.
4. **Format taxonomy: ported in full**, not trimmed. The source skill's ~20 named vertical-video formats (Library A), ~15 carousel formats (Library B), cover-slide hook formulas, carousel construction rules, and the 3-signal ranking model (shareability/savability/reach) are genuinely platform-agnostic content-strategy IP — none of it is NBA/2K-specific. It's ported into the system prompt near-verbatim, generalized only by removing NBA/2K examples. The Ronnie2K-specific brand guardrails (no gambling language, "MyPLAYER not avatar," "messenger not decision-maker" framing) are dropped entirely — those are one creator's brand rules, not general product behavior.
5. **No public share page.** Unlike Recap Card, this feature's output is a personal planning list for the creator, not an artifact meant to be posted publicly — there is no `/ideas/[id]` public equivalent to `/recap/[id]`.

## Non-goals

- No curated `niche_community_sources` pipeline in v1 — that table stays reserved/unused, same status as it's had since the scaffold plan. `web_search` replaces it as the sourcing mechanism for now; a curated-source fast-follow remains possible later without a schema change.
- No email delivery — `weekly_digests.sent_at` stays `null` in v1, exactly as flagged as out of scope for the scaffold plan. This is a fast-follow once a real scheduled-job story exists for the app (there is none today).
- No scripting/copy-writing beyond the idea-card level — matches the source skill's own stated non-goal ("does not write full scripts... chain into a copy-style skill to build a picked idea"). This feature pitches concepts only.
- No repeat-log / anti-duplication across weeks — matches the source skill's explicit "no repeat-log is kept... each run is standalone."
- No graphics/carousel-slide generation — text/copy concepts only, same as the source skill.

---

## 1. Data model & niche capture

### `profiles.niche` — already exists, now gets used

No migration needed; the column (`text`, nullable) was added in the scaffold plan's `profiles` migration and has sat unused since. `/ideas` becomes the page that sets it, via a free-text field ("What's your niche? e.g. 'NBA 2K content', 'home baking', 'personal finance for Gen Z'"), saved through a small DI handler analogous to Recap Card's `saveRecapHandles` — but simpler, since there's only one field and no URL-parsing/normalization step (a niche is free text, not a validated handle).

### `weekly_digests` — already exists, now gets used

No migration needed; the table (`profile_id`, `week_start date`, `content_ideas jsonb`, `sent_at timestamptz` nullable, `created_at`, unique `(profile_id, week_start)`) was added in the scaffold plan and has sat unused since (`sent_at` stays unused in this plan too — no email in v1). `week_start` is normalized to the Monday of the current week (UTC) at generation time. The unique constraint is what makes generation idempotent and safe to be on-demand — the same role Recap Card's `(profile_id, month)` constraint plays.

### `content_ideas` JSON shape

```ts
interface ContentIdea {
  workingTitle: string;
  pitch: string;               // one-line pitch
  medium: 'reel' | 'carousel' | 'both';
  format: string;               // e.g. "Ranked Countdown", "Tier List" — from the ported taxonomy
  whyItsHotNow: string;         // the news peg
  sourceUrl: string | null;     // citation from web_search, when available
  whyItRanksHere: string;       // ties to shareability/savability/reach
  kpiSignals: Array<'shareability' | 'savability' | 'reach'>;
  reelDetails: { suggestedLengthSeconds: number; style: 'talking-head' | 'vo-over-capture' } | null;
  carouselDetails: { hookFormula: string; coverLine: string; slideCount: number } | null;
}
```

`reelDetails`/`carouselDetails` are populated based on `medium` (both populated when `medium === 'both'`).

---

## 2. Generation pipeline

### `POST /api/ideas`

Auth required (401 if signed out, same shape as Diagnostic/Recap Card). Flow:

1. Look up the caller's `profiles.niche`. If unset, 400 ("Set your niche before generating ideas.").
2. Check for an existing `weekly_digests` row for `(profile_id, current_week_start)`. If found, return it — **no generation happens**, same cache-hit short-circuit as Recap Card.
3. Otherwise, run `checkAndRecordRateLimit` (existing `RateLimitStore`, new `content_ideas_generation` event type), using the same override shape Recap Card established: `profileLimit: 5, ipLimit: 10, windowDays: 1`.
4. Call the new `lib/integrations/claude-ideas.ts` client's `generateContentIdeas(niche, currentDate)`.
5. Parse the model's trailing fenced JSON block into `ContentIdea[]`, the same lenient strip-fences-then-`JSON.parse` pattern `lib/integrations/claude.ts` already uses for the diagnostic report, throwing a clear error on failure.
6. If the parsed array is empty, return a distinct failure (422) — no `weekly_digests` row written, so a later attempt in the same week isn't blocked by the unique constraint. A **short** list (fewer than the ~6–8 target) is not a failure — see §4.
7. Otherwise insert the `weekly_digests` row, return it.

### `lib/integrations/claude-ideas.ts`

```ts
export interface ContentIdeasClient {
  generateContentIdeas(niche: string, currentDate: Date): Promise<ContentIdea[]>;
}

export function createClaudeContentIdeasClient(apiKey: string, model = 'claude-sonnet-5'): ContentIdeasClient
```

A new, separate module from `lib/integrations/claude.ts` — different system prompt, different tool declaration, different output shape; small and focused rather than overloading the existing diagnostic-report client. (Note: the existing `claude.ts` defaults to a stale model ID (`claude-sonnet-4-5`) left over from before this app's current model catalog — this spec's new module uses the current `claude-sonnet-5` default; fixing the existing client's stale default is out of scope here.)

Single request shape:

```ts
const response = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
  body: JSON.stringify({
    model,
    max_tokens: 4096,
    system: CONTENT_IDEAS_SYSTEM_PROMPT, // ported format taxonomy + ranking model + research/output instructions
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 8 }],
    messages: [{ role: 'user', content: `Niche: ${niche}\nToday's date: ${currentDate.toISOString().slice(0, 10)}\n\nGenerate this week's content ideas.` }],
  }),
});
```

`max_uses: 8` bounds cost per generation — the `web_search` analogue of Recap Card's Apify `resultsLimit`, at Anthropic's documented $10-per-1,000-searches rate. The system prompt carries (generalized from the source skill):

- **Research instructions**: pull niche news/moment, and what other creators in the niche are riding right now; prefer things that broke in the last few days; capture a specific news peg + source per idea; explicitly **do not invent news** — if no real current hook exists for the niche, say so rather than manufacturing a generic one.
- **Library A** (vertical video formats) and **Library B** (carousel formats) — the full ported taxonomies, generalized (no NBA/2K terms).
- **Ranking model**: judge each idea against the KPI its own format is built to hit (carousels skew save-heavy, Reels skew share/reach) using the shareability → savability → reach signal ordering from the source skill.
- **Carousel construction rules**: slide-1-is-80%-of-the-game, text-on-images not captions, 8–12 slides typical, 4:5 ratio, last-slide-payoff, the "4 killers" to avoid.
- **Output instructions**: end the response with a single fenced JSON block matching the `ContentIdea[]` shape above; target ~6–8 ideas but return fewer if the niche genuinely doesn't support that many honest ideas this week.

---

## 3. Output rendering & page UI

### `/ideas` page states

Same state-machine discipline as `/recap`/`/diagnostic`, with the signed-out case designed in from the start this time (Recap Card's final review caught that gap being bolted on late — this plan avoids repeating it):

| State | UI shown |
|---|---|
| `loading` | Brief loading text while bootstrap fetch resolves. |
| `needsSignIn` | `SignInPrompt` (reused component), same pattern as Diagnostic/Recap Card's 401 handling. |
| `needsNiche` | Free-text niche field + save. |
| `readyToGenerate` | Niche saved (or already on file); "Get this week's ideas" button. Also reachable from `ideasReady`/`generationFailed` via an "edit niche" affordance. |
| `generating` | Spinner; escalating status text past ~8s (research + generation can take a while, similar to Recap Card's multi-platform scrape). |
| `ideasReady` | The rendered idea cards. Reached either right after generation or immediately on page load if this week's row already exists. |
| `generationFailed` | Distinct message for "found zero ideas this week" vs. a generic error; retry available. |

### Idea card rendering

Each `ContentIdea` renders as a card: working title + pitch, a medium/format badge (Reel / Carousel / Both — format name), "Why it's hot now" with the source link when available, "Why it ranks here" showing the KPI signal(s), and format-specific details (suggested length + talking-head-vs-VO for Reels; hook formula + slide count for carousels). No public URL, no image rendering — plain in-app cards, consistent with §"No public share page" above.

---

## 4. Error handling & edge cases

- **Outer request failure** (network, non-2xx from the Messages API): thrown and surfaced as a generic 500, same as the existing Diagnostic/Recap Card handlers' catch-all.
- **Individual `web_search` call failures are invisible to our code.** Per the tool's actual behavior, a failed search returns as a non-throwing error content block inside the response; the model works around it server-side (tries a different query, narrows scope, etc.) and still produces a final answer. Our code has nothing special to do here.
- **Malformed/missing JSON block in the final response**: thrown with a clear message ("Claude API returned a response that could not be parsed as JSON"), same pattern as `claude.ts`'s existing diagnostic-parsing error.
- **Zero ideas returned**: a distinct 422 failure (§2 step 6) — no row written, retryable within the same week without hitting the unique-constraint cache.
- **Fewer than the ~6–8 target returned**: not a failure. The system prompt explicitly instructs the model not to invent news for an obscure niche; a shorter, honest list is the correct and expected outcome for some niches, and the UI renders whatever count comes back.
- **No niche set**: 400 at generation time; the page's `needsNiche` state prevents this from being reachable through normal UI flow, but the API validates independently (same defense-in-depth precedent as Recap Card's "at least one platform" check).

## Testing

- Unit tests (pattern: `lib/diagnostic/*.test.ts`, `lib/recap/handler.test.ts`):
  - JSON-parsing logic in `claude-ideas.ts`: valid response, malformed JSON, empty-array edge case.
  - Handler branching: cache-hit short-circuit, rate-limit, no-niche 400, zero-ideas 422, success path — using a new `createFakeContentIdeasClient` in `tests/fakes/` and the existing in-memory rate-limit store fake.
- One Playwright E2E: set a niche (mocked), generate, see the idea cards render.
