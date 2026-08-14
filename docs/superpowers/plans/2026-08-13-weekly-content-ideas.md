# Weekly Content Ideas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the weekly content-ideas digest end to end — a creator sets their niche once, generates an on-demand, cached, rate-limited weekly digest of ranked Reel/carousel concepts sourced via Claude's `web_search` server tool, and views them inline on a private page.

**Architecture:** A single new integration client (`lib/integrations/claude-ideas.ts`) wraps one synchronous `POST /v1/messages` call with the `web_search_20260209` server tool declared — the research loop runs entirely on Anthropic's infrastructure, so (unlike Recap Card's Apify integration) there is no async run-then-poll machinery to build. A DI-style handler (`lib/ideas/handler.ts`, mirroring `lib/recap/handler.ts`) wires rate-limiting, the weekly-cache check, and the generate/save flow. Both already-scaffolded-but-unused schema pieces this feature needs (`profiles.niche`, `weekly_digests`) already exist from the original scaffold plan — **no migration task in this plan**. The page (`/ideas`) reuses the same state-machine and `<SignInPrompt>`-reuse pattern `/recap` established, including the signed-out state from day one (a gap Recap Card's final review had to catch and fix after the fact).

**Tech Stack:** Next.js 16 (App Router) + TypeScript, Anthropic Messages API `web_search_20260209` server tool (no new dependency — same `fetch`-based pattern the existing `lib/integrations/claude.ts` already uses), Supabase (existing), Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-13-weekly-content-ideas-design.md` (committed at `a7db4e9`) — this plan implements every section of that spec.

## Global Constraints

- No curated `niche_community_sources` pipeline in v1 — that table stays reserved/unused (spec non-goals). `web_search` is the sourcing mechanism.
- No email delivery — `weekly_digests.sent_at` stays `null`.
- No public share page — unlike Recap Card, there is no `/ideas/[id]`. Ideas render inline on `/ideas` itself.
- Generation is on-demand only, cached per `(profile, week_start)` via the existing unique constraint on `weekly_digests` — never a scheduled sweep.
- `web_search`'s `max_uses` is capped (8) to bound cost per generation — the `web_search` analogue of Recap Card's Apify `resultsLimit`, at Anthropic's documented $10-per-1,000-searches rate.
- Rate limiting reuses the existing `checkAndRecordRateLimit` with a new `content_ideas_generation` event type, using the same override shape Recap Card established: `profileLimit: 5, ipLimit: 10, windowDays: 1`.
- A short list (fewer than the ~6–8 target) is a valid success, not a failure — the system prompt explicitly forbids inventing news for niches without a real current hook. Only a genuinely empty list is a failure.
- Follow the existing DI pattern: pure, dependency-injected core logic in `lib/`, thin `route.ts` wrappers that wire real Supabase/integration clients — same shape as `lib/recap/handler.ts` / `app/api/recap/route.ts`.
- Reuse `<SignInPrompt>` (`components/SignInPrompt.tsx`) for the signed-out state, same as `/recap` — do not build a new sign-in component.

---

## File Structure

```
lib/integrations/
  claude-ideas.ts                # ContentIdea, ContentIdeasClient, CONTENT_IDEAS_SYSTEM_PROMPT, createClaudeContentIdeasClient

lib/ideas/
  niche.ts                       # normalizeNiche-free simple validation, saveNiche(deps, params)
  handler.ts                     # handleIdeasRequest(deps, context) — the generation pipeline
  page-state.ts                  # pure reducer for app/ideas/page.tsx

app/api/ideas/
  route.ts                       # GET (bootstrap: niche + this week's digest, if any) + POST (generate)
  niche/route.ts                 # POST — save niche

app/ideas/
  page.tsx                       # private: set niche, generate, view idea cards inline

app/page.tsx                     # MODIFIED — one added nav link to /ideas

tests/fakes/claude-ideas.fake.ts # createFakeContentIdeasClient

tests/unit/lib/integrations/claude-ideas.test.ts
tests/unit/lib/ideas/niche.test.ts
tests/unit/lib/ideas/handler.test.ts
tests/unit/lib/ideas/page-state.test.ts
tests/unit/app/ideas/page.test.tsx
tests/unit/app/page.test.tsx       # MODIFIED — new nav link assertion
tests/e2e/ideas-smoke.spec.ts
```

---

### Task 1: Claude content-ideas integration client

**Files:**
- Create: `lib/integrations/claude-ideas.ts`
- Create: `tests/fakes/claude-ideas.fake.ts`
- Test: `tests/unit/lib/integrations/claude-ideas.test.ts`

**Interfaces:**
- Consumes: nothing (first file in this feature)
- Produces: `ContentIdea`, `ContentIdeasClient`, `createClaudeContentIdeasClient(apiKey, model?)` — relied on by Task 3 (`lib/ideas/handler.ts`)

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lib/integrations/claude-ideas.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createClaudeContentIdeasClient } from '@/lib/integrations/claude-ideas';

describe('createClaudeContentIdeasClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the niche, today\'s date, and a capped web_search tool, then parses the trailing fenced JSON block', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        content: [
          { type: 'text', text: "Let me research this niche first." },
          { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'home baking trends this week' } },
          {
            type: 'web_search_tool_result',
            tool_use_id: 'srvtoolu_1',
            content: [{ type: 'web_search_result', url: 'https://example.com/a', title: 'Baking trend piece' }],
          },
          {
            type: 'text',
            text:
              "Here are this week's ideas:\n```json\n[{\"workingTitle\":\"Sourdough Speedrun\",\"pitch\":\"Bake a loaf in under 2 hours on camera\",\"medium\":\"reel\",\"format\":\"Speed Recap\",\"whyItsHotNow\":\"Sourdough resurgence trending this week\",\"sourceUrl\":\"https://example.com/a\",\"whyItRanksHere\":\"High reach from trend-jacking\",\"kpiSignals\":[\"reach\"],\"reelDetails\":{\"suggestedLengthSeconds\":60,\"style\":\"talking-head\"},\"carouselDetails\":null}]\n```",
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createClaudeContentIdeasClient('test-api-key');
    const ideas = await client.generateContentIdeas('home baking', new Date('2026-08-13T00:00:00Z'));

    expect(ideas).toEqual([
      {
        workingTitle: 'Sourdough Speedrun',
        pitch: 'Bake a loaf in under 2 hours on camera',
        medium: 'reel',
        format: 'Speed Recap',
        whyItsHotNow: 'Sourdough resurgence trending this week',
        sourceUrl: 'https://example.com/a',
        whyItRanksHere: 'High reach from trend-jacking',
        kpiSignals: ['reach'],
        reelDetails: { suggestedLengthSeconds: 60, style: 'talking-head' },
        carouselDetails: null,
      },
    ]);

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(requestBody.tools).toEqual([{ type: 'web_search_20260209', name: 'web_search', max_uses: 8 }]);
    expect(requestBody.model).toBe('claude-sonnet-5');
    expect(requestBody.messages[0].content).toContain('home baking');
    expect(requestBody.messages[0].content).toContain('2026-08-13');
  });

  it('throws a clear error when the response has no parseable JSON block', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ content: [{ type: 'text', text: 'Sorry, I could not find anything current for this niche.' }] }),
      })
    );
    const client = createClaudeContentIdeasClient('test-api-key');
    await expect(client.generateContentIdeas('home baking', new Date('2026-08-13T00:00:00Z'))).rejects.toThrow(
      'Claude API returned a response that could not be parsed as JSON.'
    );
  });

  it('throws when the API request itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const client = createClaudeContentIdeasClient('test-api-key');
    await expect(client.generateContentIdeas('home baking', new Date('2026-08-13T00:00:00Z'))).rejects.toThrow(
      'Claude API request failed with status 500'
    );
  });

  it('returns an empty array without throwing when the model genuinely finds nothing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ content: [{ type: 'text', text: 'Nothing current found.\n```json\n[]\n```' }] }),
      })
    );
    const client = createClaudeContentIdeasClient('test-api-key');
    const ideas = await client.generateContentIdeas('home baking', new Date('2026-08-13T00:00:00Z'));
    expect(ideas).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/integrations/claude-ideas.test.ts`
Expected: FAIL with `Cannot find module '@/lib/integrations/claude-ideas'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/integrations/claude-ideas.ts
export interface ContentIdea {
  workingTitle: string;
  pitch: string;
  medium: 'reel' | 'carousel' | 'both';
  format: string;
  whyItsHotNow: string;
  sourceUrl: string | null;
  whyItRanksHere: string;
  kpiSignals: Array<'shareability' | 'savability' | 'reach'>;
  reelDetails: { suggestedLengthSeconds: number; style: 'talking-head' | 'vo-over-capture' } | null;
  carouselDetails: { hookFormula: string; coverLine: string; slideCount: number } | null;
}

export interface ContentIdeasClient {
  generateContentIdeas(niche: string, currentDate: Date): Promise<ContentIdea[]>;
}

export const CONTENT_IDEAS_SYSTEM_PROMPT = `You are the weekly content-ideation engine for Creator Dashboard, a tool for creators under 5,000 followers.

Run this once a week for the creator's niche. Research what's current in that niche right now and hand back a ranked shortlist of ~6-8 concepts for short-form vertical video (Reels/TikTok) and Instagram carousels, tagged by medium and format. Pitch concepts only — do not write full scripts, design carousel graphics, or post anything.

## How to run

1. Anchor to today's date (given in the user message). Ideas must be timely and scoped to shoot in the next ~7 days.
2. Research the week: pull the creator's niche news/moment, and what other creators in this niche are riding right now (trending angles, formats, or audio worth jumping on). Prefer things that broke in the last few days over stale evergreen topics. For each idea, capture a specific news peg (what happened, when) and cite the source URL.
3. Do NOT invent news. If you cannot find a real, current hook for this niche, say so and return fewer ideas (even zero) rather than manufacturing a generic calendar-based one. A short, honest list is correct — do not pad it.
4. Generate ~6-8 ideas (fewer if the niche genuinely doesn't support that many honest ideas this week), each mapped to a format from one of the two libraries below.
5. Rank by distribution potential, not raw "virality" — see Ranking below.

## Library A — vertical video formats (Reels/TikTok, VO + talking-head or over B-roll/capture)

Target length up to 90s. Each idea should specify talking-head-led vs VO-over-capture.

Ranking & list: Ranked Countdown (Top-N counting down, one clip/point per entry); Tier List (drop items into S/A/B/C, defend each); Listicle (numbered, not ranked); Bracket (seed a field, walk the elimination); Draft-a-Squad (repeated this-or-that to build a set).

Debate & take: Hot Take (one bold claim, defended with evidence); Myth-Buster ("actually, that's wrong…" with proof); Overrated/Underrated (rapid-fire verdicts); Report Card (grade things, letter grades on screen).

Story & explainer: Explainer ("how X actually works"); Rise & Fall Timeline (an arc, chronological); Untold Story ("what happened to…" mini-doc on a forgotten detail); Speed Recap (compress a period/event into ~60s).

Prediction & sim: The Sim ("I simulated X," narrate how it plays out); Prediction ("calling it now," forecast with reasoning); Did-It-Age-Well (callback: a past prediction/take vs what really happened).

Reaction & trend: Reaction ("they said WHAT?" over a source clip/quote); Build Challenge (recreate something real, reveal the result); Then vs Now (evolution comparison, side-by-side); Trend-Jack (borrow a currently-viral audio/format and apply it to this niche).

## Library B — Instagram carousel formats

Story-driven: Conversational (a Reel-style VO script broken into swipeable text over images); Storytime (text-only, copy carries it); Captioned (one shareable quote per slide); Cliffhanger (every slide ends on a hook forcing the next tap).

List & rank: Ranked Listicle (numbered, one per slide); Tier List (S/A/B/C across slides); Data/Stat (big bold number leads, each slide unpacks it); Receipts ("did it call it" screenshot proof across slides).

Visual & interactive: Gamified ("swipe to reveal X"); Before/After (side-by-side contrast); Panoramic Pan (one continuous image split across slides); Vignette (cinematic clip stitch, one through-line); Zine/Collage (mixed-media themed dump).

Engagement bait: Choose-One Poll ("which are you?" swipe-through); Collection Showcase (new drops/releases relevant to the niche).

Cover-slide hook formulas (pick one per carousel): question-then-answer; surprising fact/big bold number; side-by-side comparison; swipe-for-X (gamified); jump mid-story; stunning visual (no text).

Carousel rules (enforce on every carousel idea): slide 1 is ~80% of the game, and also hook slide 2 (it gets re-served standalone in the feed); put text ON the images, not in the caption; 8-12 slides typical (up to ~20 for deep dives); 4:5 ratio (1080x1350); last slide is the payoff/reveal, screenshot-worthy; avoid the 4 killers — no theme/purpose, caption-instead-of-on-slide-text, weak hook, over-designed.

## Ranking — distribution potential

Rank by distribution potential, not raw "virality." Weigh three signals: Shareability (would someone DM this to a friend?); Savability (would someone save it to come back to — rankings, lists, breakdowns win here); Reach/scroll-stop (hook strength and trend momentum). Judge each idea against the KPI its own format is built to hit — carousels skew save-heavy, Reels skew share/reach. Every idea gets a one-line "why it ranks here" naming the KPI(s) it lands.

## Output

End your response with a single fenced \`\`\`json code block containing a JSON array matching this exact shape, and nothing else inside the fence:

[{"workingTitle": string, "pitch": string, "medium": "reel"|"carousel"|"both", "format": string, "whyItsHotNow": string, "sourceUrl": string|null, "whyItRanksHere": string, "kpiSignals": ("shareability"|"savability"|"reach")[], "reelDetails": {"suggestedLengthSeconds": number, "style": "talking-head"|"vo-over-capture"}|null, "carouselDetails": {"hookFormula": string, "coverLine": string, "slideCount": number}|null}]

Populate reelDetails when medium is "reel" or "both"; populate carouselDetails when medium is "carousel" or "both"; set the other to null. Return an empty array \`[]\` if you genuinely found no honest ideas this week — do not omit the JSON block even then.`;

function extractJsonBlock(text: string): string {
  const matches = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  if (matches.length === 0) return text.trim();
  return matches[matches.length - 1][1].trim();
}

export function createClaudeContentIdeasClient(apiKey: string, model = 'claude-sonnet-5'): ContentIdeasClient {
  return {
    async generateContentIdeas(niche: string, currentDate: Date): Promise<ContentIdea[]> {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          system: CONTENT_IDEAS_SYSTEM_PROMPT,
          tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 8 }],
          messages: [
            {
              role: 'user',
              content: `Niche: ${niche}\nToday's date: ${currentDate.toISOString().slice(0, 10)}\n\nGenerate this week's content ideas.`,
            },
          ],
        }),
      });
      if (!response.ok) {
        throw new Error(`Claude API request failed with status ${response.status}`);
      }
      const data = await response.json();
      const textBlocks = (data.content ?? []).filter((b: { type: string }) => b.type === 'text');
      const combinedText = textBlocks.map((b: { text: string }) => b.text).join('\n');
      const jsonText = extractJsonBlock(combinedText);

      let parsed: unknown;
      try {
        parsed = JSON.parse(jsonText);
      } catch {
        throw new Error('Claude API returned a response that could not be parsed as JSON.');
      }
      if (!Array.isArray(parsed)) {
        throw new Error('Claude API returned a response that could not be parsed as JSON.');
      }
      return parsed as ContentIdea[];
    },
  };
}
```

```ts
// tests/fakes/claude-ideas.fake.ts
import type { ContentIdeasClient, ContentIdea } from '@/lib/integrations/claude-ideas';

export function createFakeContentIdeasClient(ideas: ContentIdea[] = [DEFAULT_IDEA]): ContentIdeasClient {
  return {
    async generateContentIdeas(): Promise<ContentIdea[]> {
      return ideas;
    },
  };
}

const DEFAULT_IDEA: ContentIdea = {
  workingTitle: 'Sourdough Speedrun',
  pitch: 'Bake a loaf in under 2 hours on camera',
  medium: 'reel',
  format: 'Speed Recap',
  whyItsHotNow: 'Sourdough resurgence trending this week',
  sourceUrl: 'https://example.com/a',
  whyItRanksHere: 'High reach from trend-jacking',
  kpiSignals: ['reach'],
  reelDetails: { suggestedLengthSeconds: 60, style: 'talking-head' },
  carouselDetails: null,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/integrations/claude-ideas.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/integrations/claude-ideas.ts tests/fakes/claude-ideas.fake.ts tests/unit/lib/integrations/claude-ideas.test.ts
git commit -m "feat: add Claude content-ideas client using the web_search server tool"
```

---

### Task 2: Niche save — `lib/ideas/niche.ts` + route

**Files:**
- Create: `lib/ideas/niche.ts`
- Create: `app/api/ideas/niche/route.ts`
- Test: `tests/unit/lib/ideas/niche.test.ts`

**Interfaces:**
- Consumes: nothing (a plain string field, no shared types)
- Produces: `SaveNicheDeps`, `SaveNicheParams`, `SaveNicheResult`, `saveNiche(deps, params)` — relied on by Task 5 (`app/ideas/page.tsx`, via the route below)

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lib/ideas/niche.test.ts
import { describe, it, expect, vi } from 'vitest';
import { saveNiche } from '@/lib/ideas/niche';

describe('saveNiche', () => {
  it('rejects an empty or whitespace-only niche', async () => {
    const updateProfileNiche = vi.fn();
    const result = await saveNiche({ updateProfileNiche }, { profileId: 'p1', niche: '   ' });
    expect(result.status).toBe(400);
    expect(updateProfileNiche).not.toHaveBeenCalled();
  });

  it('rejects a niche over 200 characters', async () => {
    const updateProfileNiche = vi.fn();
    const result = await saveNiche({ updateProfileNiche }, { profileId: 'p1', niche: 'x'.repeat(201) });
    expect(result.status).toBe(400);
    expect(updateProfileNiche).not.toHaveBeenCalled();
  });

  it('trims and saves a valid niche', async () => {
    const updateProfileNiche = vi.fn().mockResolvedValue(undefined);
    const result = await saveNiche({ updateProfileNiche }, { profileId: 'p1', niche: '  home baking  ' });
    expect(result.status).toBe(200);
    expect(updateProfileNiche).toHaveBeenCalledWith('p1', 'home baking');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/ideas/niche.test.ts`
Expected: FAIL with `Cannot find module '@/lib/ideas/niche'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/ideas/niche.ts
const MAX_NICHE_LENGTH = 200;

export interface SaveNicheDeps {
  updateProfileNiche: (profileId: string, niche: string) => Promise<void>;
}

export interface SaveNicheParams {
  profileId: string;
  niche: string;
}

export interface SaveNicheResult {
  status: number;
  body: { ok: true } | { error: string };
}

export async function saveNiche(deps: SaveNicheDeps, params: SaveNicheParams): Promise<SaveNicheResult> {
  const trimmed = params.niche.trim();
  if (!trimmed) {
    return { status: 400, body: { error: 'Enter a niche before saving.' } };
  }
  if (trimmed.length > MAX_NICHE_LENGTH) {
    return { status: 400, body: { error: `Keep your niche under ${MAX_NICHE_LENGTH} characters.` } };
  }

  await deps.updateProfileNiche(params.profileId, trimmed);
  return { status: 200, body: { ok: true } };
}
```

```ts
// app/api/ideas/niche/route.ts
import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { saveNiche } from '@/lib/ideas/niche';

export async function POST(request: Request) {
  const body = (await request.json()) as { niche?: string };

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'You must be signed in to set your niche.' }, { status: 401 });
  }

  const serviceClient = createSupabaseServiceRoleClient();
  const result = await saveNiche(
    {
      updateProfileNiche: async (profileId, niche) => {
        const { error } = await serviceClient.from('profiles').update({ niche }).eq('id', profileId);
        if (error) {
          throw new Error(`Failed to save niche: ${error.message}`);
        }
      },
    },
    { profileId: user.id, niche: body.niche ?? '' }
  );

  return NextResponse.json(result.body, { status: result.status });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/ideas/niche.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/ideas/niche.ts app/api/ideas/niche/route.ts tests/unit/lib/ideas/niche.test.ts
git commit -m "feat: add niche validation, save logic, and POST /api/ideas/niche"
```

---

### Task 3: Ideas generation handler + `/api/ideas` route

**Files:**
- Create: `lib/ideas/handler.ts`
- Create: `app/api/ideas/route.ts`
- Test: `tests/unit/lib/ideas/handler.test.ts`

**Interfaces:**
- Consumes: `RateLimitStore`, `checkAndRecordRateLimit`, `releaseRateLimitEventIfNeeded`, `hashIp` from `@/lib/rate-limit` (existing); `ContentIdeasClient`, `ContentIdea` from `@/lib/integrations/claude-ideas` (Task 1)
- Produces: `IDEAS_GENERATION_PROFILE_LIMIT`, `IDEAS_GENERATION_IP_LIMIT`, `WeeklyDigestRow`, `IdeasHandlerDeps`, `IdeasRequestContext`, `handleIdeasRequest(deps, context)` — relied on by Task 5 (`app/ideas/page.tsx`, via the route below)

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lib/ideas/handler.test.ts
import { describe, it, expect } from 'vitest';
import { handleIdeasRequest, IDEAS_GENERATION_PROFILE_LIMIT } from '@/lib/ideas/handler';
import { createInMemoryRateLimitStore } from '../../../fakes/rate-limit-store.fake';
import { createFakeContentIdeasClient } from '../../../fakes/claude-ideas.fake';
import type { WeeklyDigestRow } from '@/lib/ideas/handler';
import type { ContentIdea } from '@/lib/integrations/claude-ideas';

const IDEA: ContentIdea = {
  workingTitle: 'Sourdough Speedrun',
  pitch: 'Bake a loaf in under 2 hours on camera',
  medium: 'reel',
  format: 'Speed Recap',
  whyItsHotNow: 'Sourdough resurgence trending this week',
  sourceUrl: 'https://example.com/a',
  whyItRanksHere: 'High reach from trend-jacking',
  kpiSignals: ['reach'],
  reelDetails: { suggestedLengthSeconds: 60, style: 'talking-head' },
  carouselDetails: null,
};

function makeDeps(overrides: Partial<Parameters<typeof handleIdeasRequest>[0]> = {}) {
  const savedDigests: WeeklyDigestRow[] = [];
  return {
    rateLimitStore: createInMemoryRateLimitStore(),
    contentIdeasClient: createFakeContentIdeasClient([IDEA]),
    ipSalt: 'test-salt',
    getProfileNiche: async () => 'home baking',
    getExistingDigest: async () => null,
    saveDigest: async (params: { profileId: string; weekStart: string; contentIdeas: ContentIdea[] }) => {
      const row: WeeklyDigestRow = { id: `digest-${savedDigests.length + 1}`, profileId: params.profileId, weekStart: params.weekStart, contentIdeas: params.contentIdeas };
      savedDigests.push(row);
      return row;
    },
    ...overrides,
  };
}

// A Thursday — picking a mid-week date makes the Monday-of-week math in
// the handler's weekStartKey() actually exercise the "go backward" branch.
const NOW = new Date('2026-08-13T12:00:00Z');

describe('handleIdeasRequest', () => {
  it('rejects requests without a signed-in profile', async () => {
    const result = await handleIdeasRequest(makeDeps(), { profileId: null, ip: '203.0.113.1', now: NOW });
    expect(result.status).toBe(401);
  });

  it('rejects when no niche is set', async () => {
    const deps = makeDeps({ getProfileNiche: async () => null });
    const result = await handleIdeasRequest(deps, { profileId: 'p1', ip: '203.0.113.1', now: NOW });
    expect(result.status).toBe(400);
  });

  it('returns the existing digest for this week without generating again', async () => {
    const contentIdeasClient = createFakeContentIdeasClient([IDEA]);
    const existing: WeeklyDigestRow = { id: 'digest-existing', profileId: 'p1', weekStart: '2026-08-10', contentIdeas: [IDEA] };
    const deps = makeDeps({ contentIdeasClient, getExistingDigest: async () => existing });

    const result = await handleIdeasRequest(deps, { profileId: 'p1', ip: '203.0.113.1', now: NOW });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ digest: existing });
  });

  it('generates and saves a new digest, keying the week to the Monday of the current week', async () => {
    const deps = makeDeps();
    const result = await handleIdeasRequest(deps, { profileId: 'p1', ip: '203.0.113.1', now: NOW });
    expect(result.status).toBe(200);
    const body = result.body as { digest: WeeklyDigestRow };
    expect(body.digest.weekStart).toBe('2026-08-10'); // Monday of the week containing 2026-08-13 (Thursday)
    expect(body.digest.contentIdeas).toEqual([IDEA]);
  });

  it('returns a distinct 422 without saving when generation finds zero ideas', async () => {
    const deps = makeDeps({ contentIdeasClient: createFakeContentIdeasClient([]) });
    const result = await handleIdeasRequest(deps, { profileId: 'p1', ip: '203.0.113.1', now: NOW });
    expect(result.status).toBe(422);
  });

  it('rate-limits repeated generation attempts per profile per day', async () => {
    const deps = makeDeps({ contentIdeasClient: createFakeContentIdeasClient([]) });
    let result;
    for (let i = 0; i < IDEAS_GENERATION_PROFILE_LIMIT; i++) {
      result = await handleIdeasRequest(deps, { profileId: 'p1', ip: '203.0.113.1', now: NOW });
      expect(result.status).toBe(422); // zero ideas each time, but still consumes an attempt
    }
    result = await handleIdeasRequest(deps, { profileId: 'p1', ip: '203.0.113.1', now: NOW });
    expect(result.status).toBe(429);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/ideas/handler.test.ts`
Expected: FAIL with `Cannot find module '@/lib/ideas/handler'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/ideas/handler.ts
import { checkAndRecordRateLimit, releaseRateLimitEventIfNeeded, hashIp, type RateLimitStore } from '@/lib/rate-limit';
import type { ContentIdeasClient, ContentIdea } from '@/lib/integrations/claude-ideas';

export const IDEAS_GENERATION_PROFILE_LIMIT = 5;
export const IDEAS_GENERATION_IP_LIMIT = 10;

export interface WeeklyDigestRow {
  id: string;
  profileId: string;
  weekStart: string;
  contentIdeas: ContentIdea[];
}

export interface IdeasHandlerDeps {
  rateLimitStore: RateLimitStore;
  contentIdeasClient: ContentIdeasClient;
  ipSalt: string;
  getProfileNiche: (profileId: string) => Promise<string | null>;
  getExistingDigest: (profileId: string, weekStart: string) => Promise<WeeklyDigestRow | null>;
  saveDigest: (params: { profileId: string; weekStart: string; contentIdeas: ContentIdea[] }) => Promise<WeeklyDigestRow>;
}

export interface IdeasRequestContext {
  profileId: string | null;
  ip: string;
  now: Date;
}

export interface IdeasHandlerResult {
  status: number;
  body: Record<string, unknown>;
}

/** Monday of the week containing `date`, as a UTC date string (YYYY-MM-DD). */
export function weekStartKey(date: Date): string {
  const day = date.getUTCDay(); // 0 = Sunday, 1 = Monday, ...
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + diffToMonday));
  return monday.toISOString().slice(0, 10);
}

export async function handleIdeasRequest(deps: IdeasHandlerDeps, context: IdeasRequestContext): Promise<IdeasHandlerResult> {
  if (!context.profileId) {
    return { status: 401, body: { error: 'You must be signed in to generate content ideas.' } };
  }

  const niche = await deps.getProfileNiche(context.profileId);
  if (!niche) {
    return { status: 400, body: { error: 'Set your niche before generating ideas.' } };
  }

  const weekStart = weekStartKey(context.now);

  const existing = await deps.getExistingDigest(context.profileId, weekStart);
  if (existing) {
    return { status: 200, body: { digest: existing } };
  }

  const ipHash = hashIp(context.ip, deps.ipSalt);
  const rateLimitResult = await checkAndRecordRateLimit({
    store: deps.rateLimitStore,
    profileId: context.profileId,
    ipHash,
    eventType: 'content_ideas_generation',
    profileLimit: IDEAS_GENERATION_PROFILE_LIMIT,
    ipLimit: IDEAS_GENERATION_IP_LIMIT,
    windowDays: 1,
    now: context.now,
  });

  if (!rateLimitResult.allowed) {
    return {
      status: 429,
      body: {
        error:
          rateLimitResult.reason === 'ip_limit'
            ? 'Too many idea generations have been requested from this network recently. Please try again later.'
            : "You've hit today's limit for idea generation attempts. Please try again tomorrow.",
        retryAfter: rateLimitResult.retryAfter?.toISOString(),
      },
    };
  }

  try {
    const ideas = await deps.contentIdeasClient.generateContentIdeas(niche, context.now);

    if (ideas.length === 0) {
      // A real, costly generation ran and genuinely found nothing honest
      // for this niche this week — not our own failure, so the
      // rate-limit event is NOT released; it's a legitimate use of one
      // of today's attempts. No row is written, so a later attempt this
      // week isn't blocked by the (profile, week_start) unique
      // constraint. Mirrors spec §4 / Recap Card's identical rule.
      return {
        status: 422,
        body: { error: "Couldn't find a real, current angle for your niche this week. Try again in a day or two." },
      };
    }

    const saved = await deps.saveDigest({ profileId: context.profileId, weekStart, contentIdeas: ideas });
    return { status: 200, body: { digest: saved } };
  } catch (err) {
    await releaseRateLimitEventIfNeeded({ store: deps.rateLimitStore, eventId: rateLimitResult.eventId });
    throw err;
  }
}
```

```ts
// app/api/ideas/route.ts
import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { createSupabaseRateLimitStore } from '@/lib/supabase/rate-limit-store';
import { createClaudeContentIdeasClient } from '@/lib/integrations/claude-ideas';
import { deriveClientIp } from '@/lib/ip';
import { handleIdeasRequest, weekStartKey } from '@/lib/ideas/handler';
import type { WeeklyDigestRow } from '@/lib/ideas/handler';
import type { ContentIdea } from '@/lib/integrations/claude-ideas';

function mapDigestRow(row: { id: string; profile_id: string; week_start: string; content_ideas: unknown }): WeeklyDigestRow {
  return {
    id: row.id,
    profileId: row.profile_id,
    weekStart: row.week_start,
    contentIdeas: row.content_ideas as ContentIdea[],
  };
}

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'You must be signed in to view your content ideas.' }, { status: 401 });
  }

  const serviceClient = createSupabaseServiceRoleClient();
  const { data: profile } = await serviceClient.from('profiles').select('niche').eq('id', user.id).single();

  const { data: existingDigest } = await serviceClient
    .from('weekly_digests')
    .select('*')
    .eq('profile_id', user.id)
    .eq('week_start', weekStartKey(new Date()))
    .maybeSingle();

  return NextResponse.json({
    niche: profile?.niche ?? null,
    digest: existingDigest ? mapDigestRow(existingDigest) : null,
  });
}

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const serviceClient = createSupabaseServiceRoleClient();
    const ip = deriveClientIp({
      headers: request.headers,
      isTrustedPlatform: process.env.VERCEL === '1',
      trustedProxyHops: process.env.TRUSTED_PROXY_HOPS ? Number(process.env.TRUSTED_PROXY_HOPS) : undefined,
    });

    const result = await handleIdeasRequest(
      {
        rateLimitStore: createSupabaseRateLimitStore(serviceClient),
        contentIdeasClient: createClaudeContentIdeasClient(process.env.ANTHROPIC_API_KEY ?? ''),
        ipSalt: process.env.RATE_LIMIT_IP_SALT ?? 'dev-salt',
        getProfileNiche: async (profileId) => {
          const { data } = await serviceClient.from('profiles').select('niche').eq('id', profileId).single();
          return data?.niche ?? null;
        },
        getExistingDigest: async (profileId, weekStart) => {
          const { data } = await serviceClient
            .from('weekly_digests')
            .select('*')
            .eq('profile_id', profileId)
            .eq('week_start', weekStart)
            .maybeSingle();
          return data ? mapDigestRow(data) : null;
        },
        saveDigest: async ({ profileId, weekStart, contentIdeas }) => {
          const { data, error } = await serviceClient
            .from('weekly_digests')
            .insert({ profile_id: profileId, week_start: weekStart, content_ideas: contentIdeas })
            .select('*')
            .single();
          if (error || !data) {
            throw new Error(`Failed to save weekly digest: ${error?.message}`);
          }
          return mapDigestRow(data);
        },
      },
      { profileId: user?.id ?? null, ip, now: new Date() }
    );

    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    console.error('Content ideas generation failed:', err);
    return NextResponse.json({ error: 'Something went wrong generating your content ideas. Please try again.' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/ideas/handler.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/ideas/handler.ts app/api/ideas/route.ts tests/unit/lib/ideas/handler.test.ts
git commit -m "feat: add content ideas generation handler and GET/POST /api/ideas route"
```

---

### Task 4: `/ideas` page state machine

**Files:**
- Create: `lib/ideas/page-state.ts`
- Test: `tests/unit/lib/ideas/page-state.test.ts`

**Interfaces:**
- Consumes: `isValidEmailFormat` from `@/lib/auth/sign-in-flow-state` (existing); `ContentIdea` from `@/lib/integrations/claude-ideas` (Task 1)
- Produces: `IdeasPageState`, `IdeasPageEvent`, `createInitialIdeasPageState()`, `isNicheEditingState(state)`, `ideasPageReducer(state, event)` — relied on by Task 5 (`app/ideas/page.tsx`)

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lib/ideas/page-state.test.ts
import { describe, it, expect } from 'vitest';
import { ideasPageReducer, createInitialIdeasPageState, isNicheEditingState, type IdeasPageState } from '@/lib/ideas/page-state';
import type { ContentIdea } from '@/lib/integrations/claude-ideas';

const IDEA: ContentIdea = {
  workingTitle: 'Sourdough Speedrun',
  pitch: 'Bake a loaf in under 2 hours on camera',
  medium: 'reel',
  format: 'Speed Recap',
  whyItsHotNow: 'Sourdough resurgence trending this week',
  sourceUrl: 'https://example.com/a',
  whyItRanksHere: 'High reach from trend-jacking',
  kpiSignals: ['reach'],
  reelDetails: { suggestedLengthSeconds: 60, style: 'talking-head' },
  carouselDetails: null,
};

describe('createInitialIdeasPageState', () => {
  it('starts in loading', () => {
    expect(createInitialIdeasPageState()).toEqual({ status: 'loading' });
  });
});

describe('ideasPageReducer — bootstrap', () => {
  it('moves to needsNiche when no niche is set', () => {
    const next = ideasPageReducer({ status: 'loading' }, { type: 'BOOTSTRAPPED', niche: '', ideas: null });
    expect(next).toEqual({ status: 'needsNiche', niche: '', error: null });
  });

  it('moves to readyToGenerate when a niche is already set and no digest exists yet', () => {
    const next = ideasPageReducer({ status: 'loading' }, { type: 'BOOTSTRAPPED', niche: 'home baking', ideas: null });
    expect(next).toEqual({ status: 'readyToGenerate', niche: 'home baking' });
  });

  it('moves straight to ideasReady when this week already has a digest', () => {
    const next = ideasPageReducer({ status: 'loading' }, { type: 'BOOTSTRAPPED', niche: 'home baking', ideas: [IDEA] });
    expect(next).toEqual({ status: 'ideasReady', niche: 'home baking', ideas: [IDEA] });
  });

  it('moves to needsNiche with an error on BOOTSTRAP_FAILED', () => {
    const next = ideasPageReducer({ status: 'loading' }, { type: 'BOOTSTRAP_FAILED' });
    expect(next).toEqual({
      status: 'needsNiche',
      niche: '',
      error: "We couldn't load your content ideas settings. Please refresh and try again.",
    });
  });

  it('moves to needsSignIn on BOOTSTRAP_UNAUTHORIZED', () => {
    const next = ideasPageReducer({ status: 'loading' }, { type: 'BOOTSTRAP_UNAUTHORIZED' });
    expect(next).toEqual({ status: 'needsSignIn', email: '', notice: null });
  });
});

describe('ideasPageReducer — niche editing', () => {
  it('updates the niche field from needsNiche', () => {
    const state: IdeasPageState = { status: 'needsNiche', niche: '', error: null };
    expect(ideasPageReducer(state, { type: 'NICHE_CHANGED', value: 'home baking' })).toEqual({
      status: 'needsNiche',
      niche: 'home baking',
      error: null,
    });
  });

  it('ignores NICHE_CHANGED while generating (impossible-state guard)', () => {
    const state: IdeasPageState = { status: 'generating', niche: 'home baking', stillWorking: false };
    expect(ideasPageReducer(state, { type: 'NICHE_CHANGED', value: 'x' })).toBe(state);
  });

  it('moves needsNiche to readyToGenerate on NICHE_SAVED', () => {
    const state: IdeasPageState = { status: 'needsNiche', niche: 'home baking', error: null };
    expect(ideasPageReducer(state, { type: 'NICHE_SAVED' })).toEqual({ status: 'readyToGenerate', niche: 'home baking' });
  });

  it('preserves the niche and sets an error on NICHE_SAVE_FAILED', () => {
    const state: IdeasPageState = { status: 'needsNiche', niche: 'x'.repeat(201), error: null };
    expect(ideasPageReducer(state, { type: 'NICHE_SAVE_FAILED', error: 'boom' })).toEqual({
      status: 'needsNiche',
      niche: 'x'.repeat(201),
      error: 'boom',
    });
  });

  it('returns from ideasReady to readyToGenerate on EDIT_NICHE', () => {
    const state: IdeasPageState = { status: 'ideasReady', niche: 'home baking', ideas: [IDEA] };
    expect(ideasPageReducer(state, { type: 'EDIT_NICHE' })).toEqual({ status: 'readyToGenerate', niche: 'home baking' });
  });
});

describe('ideasPageReducer — generation', () => {
  const niche = 'home baking';

  it('moves readyToGenerate to generating on GENERATE', () => {
    expect(ideasPageReducer({ status: 'readyToGenerate', niche }, { type: 'GENERATE' })).toEqual({
      status: 'generating',
      niche,
      stillWorking: false,
    });
  });

  it('also allows GENERATE to retry from generationFailed', () => {
    const state: IdeasPageState = { status: 'generationFailed', niche, error: 'boom' };
    expect(ideasPageReducer(state, { type: 'GENERATE' })).toEqual({ status: 'generating', niche, stillWorking: false });
  });

  it('sets stillWorking on GENERATE_STILL_WORKING without changing status', () => {
    const state: IdeasPageState = { status: 'generating', niche, stillWorking: false };
    expect(ideasPageReducer(state, { type: 'GENERATE_STILL_WORKING' })).toEqual({ status: 'generating', niche, stillWorking: true });
  });

  it('moves to ideasReady on GENERATE_SUCCESS', () => {
    const state: IdeasPageState = { status: 'generating', niche, stillWorking: true };
    expect(ideasPageReducer(state, { type: 'GENERATE_SUCCESS', ideas: [IDEA] })).toEqual({
      status: 'ideasReady',
      niche,
      ideas: [IDEA],
    });
  });

  it('moves to generationFailed preserving the niche on GENERATE_FAILED', () => {
    const state: IdeasPageState = { status: 'generating', niche, stillWorking: false };
    expect(ideasPageReducer(state, { type: 'GENERATE_FAILED', error: 'boom' })).toEqual({
      status: 'generationFailed',
      niche,
      error: 'boom',
    });
  });

  it('ignores GENERATE from needsNiche (impossible-state guard)', () => {
    const state: IdeasPageState = { status: 'needsNiche', niche: '', error: null };
    expect(ideasPageReducer(state, { type: 'GENERATE' })).toBe(state);
  });
});

describe('isNicheEditingState', () => {
  it('is true for needsNiche, readyToGenerate, and generationFailed', () => {
    expect(isNicheEditingState({ status: 'needsNiche', niche: '', error: null })).toBe(true);
    expect(isNicheEditingState({ status: 'readyToGenerate', niche: 'x' })).toBe(true);
    expect(isNicheEditingState({ status: 'generationFailed', niche: 'x', error: 'e' })).toBe(true);
  });

  it('is false for generating and ideasReady', () => {
    expect(isNicheEditingState({ status: 'generating', niche: 'x', stillWorking: false })).toBe(false);
    expect(isNicheEditingState({ status: 'ideasReady', niche: 'x', ideas: [] })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/ideas/page-state.test.ts`
Expected: FAIL with `Cannot find module '@/lib/ideas/page-state'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/ideas/page-state.ts
import { isValidEmailFormat } from '@/lib/auth/sign-in-flow-state';
import type { ContentIdea } from '@/lib/integrations/claude-ideas';

export type IdeasPageState =
  | { status: 'loading' }
  | { status: 'needsNiche'; niche: string; error: string | null }
  | { status: 'readyToGenerate'; niche: string }
  | { status: 'generating'; niche: string; stillWorking: boolean }
  | { status: 'ideasReady'; niche: string; ideas: ContentIdea[] }
  | { status: 'generationFailed'; niche: string; error: string }
  // Sign-in sub-flow, mirroring lib/recap/page-state.ts so the same
  // <SignInPrompt> component drives it.
  | { status: 'needsSignIn'; email: string; notice: string | null }
  | { status: 'submittingMagicLink'; email: string }
  | { status: 'checkEmail'; email: string }
  | { status: 'magicLinkError'; email: string; error: string };

export type IdeasPageEvent =
  | { type: 'BOOTSTRAPPED'; niche: string; ideas: ContentIdea[] | null }
  | { type: 'BOOTSTRAP_FAILED' }
  | { type: 'BOOTSTRAP_UNAUTHORIZED' }
  | { type: 'NICHE_CHANGED'; value: string }
  | { type: 'NICHE_SAVED' }
  | { type: 'NICHE_SAVE_FAILED'; error: string }
  | { type: 'GENERATE' }
  | { type: 'GENERATE_STILL_WORKING' }
  | { type: 'GENERATE_SUCCESS'; ideas: ContentIdea[] }
  | { type: 'GENERATE_FAILED'; error: string }
  | { type: 'EDIT_NICHE' }
  | { type: 'EMAIL_CHANGED'; email: string }
  | { type: 'SUBMIT_EMAIL' }
  | { type: 'MAGIC_LINK_SENT' }
  | { type: 'MAGIC_LINK_FAILED'; error: string }
  | { type: 'RESEND_EMAIL' }
  | { type: 'RETRY_EMAIL' };

const NICHE_EDITING_STATUSES = ['needsNiche', 'readyToGenerate', 'generationFailed'] as const;
type NicheEditingStatus = (typeof NICHE_EDITING_STATUSES)[number];

export function isNicheEditingState(state: IdeasPageState): state is Extract<IdeasPageState, { status: NicheEditingStatus }> {
  return (NICHE_EDITING_STATUSES as readonly string[]).includes(state.status);
}

export function createInitialIdeasPageState(): IdeasPageState {
  return { status: 'loading' };
}

export function ideasPageReducer(state: IdeasPageState, event: IdeasPageEvent): IdeasPageState {
  switch (event.type) {
    case 'BOOTSTRAPPED':
      if (event.ideas) {
        return { status: 'ideasReady', niche: event.niche, ideas: event.ideas };
      }
      return event.niche
        ? { status: 'readyToGenerate', niche: event.niche }
        : { status: 'needsNiche', niche: '', error: null };

    case 'BOOTSTRAP_FAILED':
      return {
        status: 'needsNiche',
        niche: '',
        error: "We couldn't load your content ideas settings. Please refresh and try again.",
      };

    case 'BOOTSTRAP_UNAUTHORIZED':
      return { status: 'needsSignIn', email: '', notice: null };

    case 'NICHE_CHANGED':
      return isNicheEditingState(state) ? { ...state, niche: event.value } : state;

    case 'NICHE_SAVED':
      if (!isNicheEditingState(state)) return state;
      return state.niche.trim()
        ? { status: 'readyToGenerate', niche: state.niche }
        : { status: 'needsNiche', niche: state.niche, error: null };

    case 'NICHE_SAVE_FAILED':
      return isNicheEditingState(state) ? { status: 'needsNiche', niche: state.niche, error: event.error } : state;

    case 'GENERATE':
      return state.status === 'readyToGenerate' || state.status === 'generationFailed'
        ? { status: 'generating', niche: state.niche, stillWorking: false }
        : state;

    case 'GENERATE_STILL_WORKING':
      return state.status === 'generating' ? { ...state, stillWorking: true } : state;

    case 'GENERATE_SUCCESS':
      return state.status === 'generating' ? { status: 'ideasReady', niche: state.niche, ideas: event.ideas } : state;

    case 'GENERATE_FAILED':
      return state.status === 'generating' ? { status: 'generationFailed', niche: state.niche, error: event.error } : state;

    case 'EDIT_NICHE':
      return state.status === 'ideasReady' ? { status: 'readyToGenerate', niche: state.niche } : state;

    case 'EMAIL_CHANGED':
      return state.status === 'needsSignIn' || state.status === 'magicLinkError'
        ? { ...state, email: event.email }
        : state;

    case 'SUBMIT_EMAIL':
      if (state.status !== 'needsSignIn' && state.status !== 'magicLinkError') return state;
      if (!isValidEmailFormat(state.email)) return state;
      return { status: 'submittingMagicLink', email: state.email };

    case 'MAGIC_LINK_SENT':
      return state.status === 'submittingMagicLink' ? { status: 'checkEmail', email: state.email } : state;

    case 'MAGIC_LINK_FAILED':
      return state.status === 'submittingMagicLink'
        ? { status: 'magicLinkError', email: state.email, error: event.error }
        : state;

    case 'RESEND_EMAIL':
      return state.status === 'checkEmail' ? { status: 'submittingMagicLink', email: state.email } : state;

    case 'RETRY_EMAIL':
      return state.status === 'checkEmail' ? { status: 'needsSignIn', email: state.email, notice: null } : state;

    default:
      return state;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/ideas/page-state.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/ideas/page-state.ts tests/unit/lib/ideas/page-state.test.ts
git commit -m "feat: add content ideas page state machine"
```

---

### Task 5: `/ideas` page + landing page link

**Files:**
- Create: `app/ideas/page.tsx`
- Test: `tests/unit/app/ideas/page.test.tsx`
- Modify: `app/page.tsx`
- Modify: `tests/unit/app/page.test.tsx`

**Interfaces:**
- Consumes: `ideasPageReducer`, `createInitialIdeasPageState`, `isNicheEditingState` from `@/lib/ideas/page-state` (Task 4); `<Spinner>` from `@/components/Spinner` (existing); `<SignInPrompt>` from `@/components/SignInPrompt` (existing); `GET`/`POST /api/ideas` (Task 3), `POST /api/ideas/niche` (Task 2), `POST /api/auth/magic-link` (existing) response shapes
- Produces: `IdeasPage` default export — exercised end-to-end by Task 6's Playwright test

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/app/ideas/page.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import IdeasPage from '@/app/ideas/page';

describe('IdeasPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the niche form when no niche is set yet', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ niche: null, digest: null }) })
    );
    render(<IdeasPage />);
    await waitFor(() => expect(screen.getByLabelText(/your niche/i)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /get this week's ideas/i })).not.toBeInTheDocument();
  });

  it('shows the idea cards directly when this week already has a digest', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          niche: 'home baking',
          digest: {
            id: 'digest-1',
            weekStart: '2026-08-10',
            contentIdeas: [
              {
                workingTitle: 'Sourdough Speedrun',
                pitch: 'Bake a loaf in under 2 hours on camera',
                medium: 'reel',
                format: 'Speed Recap',
                whyItsHotNow: 'Sourdough resurgence trending this week',
                sourceUrl: 'https://example.com/a',
                whyItRanksHere: 'High reach from trend-jacking',
                kpiSignals: ['reach'],
                reelDetails: { suggestedLengthSeconds: 60, style: 'talking-head' },
                carouselDetails: null,
              },
            ],
          },
        }),
      })
    );
    render(<IdeasPage />);
    await waitFor(() => expect(screen.getByText('Sourdough Speedrun')).toBeInTheDocument());
    expect(screen.getByText(/Bake a loaf in under 2 hours on camera/)).toBeInTheDocument();
  });

  it('shows the generate button once a niche is set, and generating renders the returned ideas', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ niche: 'home baking', digest: null }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          digest: {
            id: 'digest-2',
            weekStart: '2026-08-10',
            contentIdeas: [
              {
                workingTitle: 'Sourdough Speedrun',
                pitch: 'Bake a loaf in under 2 hours on camera',
                medium: 'reel',
                format: 'Speed Recap',
                whyItsHotNow: 'Sourdough resurgence trending this week',
                sourceUrl: 'https://example.com/a',
                whyItRanksHere: 'High reach from trend-jacking',
                kpiSignals: ['reach'],
                reelDetails: { suggestedLengthSeconds: 60, style: 'talking-head' },
                carouselDetails: null,
              },
            ],
          },
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    render(<IdeasPage />);
    await waitFor(() => screen.getByRole('button', { name: /get this week's ideas/i }));
    fireEvent.click(screen.getByRole('button', { name: /get this week's ideas/i }));

    await waitFor(() => expect(screen.getByText('Sourdough Speedrun')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenLastCalledWith('/api/ideas', { method: 'POST' });
  });

  it('shows an error and a retry button when generation fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ niche: 'home baking', digest: null }) })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Couldn't find a real, current angle for your niche this week. Try again in a day or two." }),
      });
    vi.stubGlobal('fetch', fetchMock);

    render(<IdeasPage />);
    await waitFor(() => screen.getByRole('button', { name: /get this week's ideas/i }));
    fireEvent.click(screen.getByRole('button', { name: /get this week's ideas/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Couldn't find a real, current angle"));
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('shows the sign-in prompt when the bootstrap fetch is unauthorized', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'unauthorized' }) }));
    render(<IdeasPage />);
    await waitFor(() => expect(screen.getByLabelText('Email')).toBeInTheDocument());
  });

  it('saves the niche and shows the generate button on success', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ niche: null, digest: null }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<IdeasPage />);
    await waitFor(() => screen.getByLabelText(/your niche/i));
    fireEvent.change(screen.getByLabelText(/your niche/i), { target: { value: 'home baking' } });
    fireEvent.click(screen.getByRole('button', { name: /save niche/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: /get this week's ideas/i })).toBeInTheDocument());
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/ideas/niche',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ niche: 'home baking' }) })
    );
  });
});
```

Append this assertion inside the existing `describe` block in `tests/unit/app/page.test.tsx` (matching whatever structure that file already uses to render `HomePage` and query links):

```ts
  it('links to the content ideas page', () => {
    render(<HomePage />);
    expect(screen.getByRole('link', { name: /content ideas/i })).toHaveAttribute('href', '/ideas');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/app/ideas/page.test.tsx tests/unit/app/page.test.tsx`
Expected: FAIL — `Cannot find module '@/app/ideas/page'`, and the new landing-page link assertion fails against today's markup.

- [ ] **Step 3: Write minimal implementation**

```tsx
// app/ideas/page.tsx
'use client';

import { useEffect, useReducer, useRef } from 'react';
import { Spinner } from '@/components/Spinner';
import { SignInPrompt } from '@/components/SignInPrompt';
import { ideasPageReducer, createInitialIdeasPageState, isNicheEditingState } from '@/lib/ideas/page-state';
import type { ContentIdea } from '@/lib/integrations/claude-ideas';

const MEDIUM_LABELS: Record<ContentIdea['medium'], string> = {
  reel: 'Reel',
  carousel: 'Carousel',
  both: 'Reel + Carousel',
};

export default function IdeasPage() {
  const [state, dispatch] = useReducer(ideasPageReducer, createInitialIdeasPageState());
  const stillWorkingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/ideas')
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401) {
          dispatch({ type: 'BOOTSTRAP_UNAUTHORIZED' });
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        if (data.error) {
          dispatch({ type: 'BOOTSTRAP_FAILED' });
          return;
        }
        dispatch({ type: 'BOOTSTRAPPED', niche: data.niche ?? '', ideas: data.digest?.contentIdeas ?? null });
      })
      .catch(() => {
        if (!cancelled) dispatch({ type: 'BOOTSTRAP_FAILED' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (state.status !== 'generating') return undefined;
    stillWorkingTimer.current = setTimeout(() => dispatch({ type: 'GENERATE_STILL_WORKING' }), 8000);
    return () => {
      if (stillWorkingTimer.current) clearTimeout(stillWorkingTimer.current);
    };
  }, [state.status]);

  async function saveNiche() {
    if (!isNicheEditingState(state)) return;
    try {
      const res = await fetch('/api/ideas/niche', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ niche: state.niche }),
      });
      const data = await res.json();
      if (!res.ok) {
        dispatch({ type: 'NICHE_SAVE_FAILED', error: data.error ?? 'Something went wrong saving your niche.' });
        return;
      }
      dispatch({ type: 'NICHE_SAVED' });
    } catch {
      dispatch({ type: 'NICHE_SAVE_FAILED', error: "We couldn't reach the server. Check your connection and try again." });
    }
  }

  async function generate() {
    dispatch({ type: 'GENERATE' });
    try {
      const res = await fetch('/api/ideas', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        dispatch({ type: 'GENERATE_FAILED', error: data.error ?? 'Something went wrong generating your content ideas.' });
        return;
      }
      dispatch({ type: 'GENERATE_SUCCESS', ideas: data.digest.contentIdeas });
    } catch {
      dispatch({ type: 'GENERATE_FAILED', error: "We couldn't reach the server. Check your connection and try again." });
    }
  }

  async function submitMagicLink(email: string) {
    try {
      const response = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, redirectPath: '/ideas' }),
      });
      const data = await response.json();
      if (!response.ok) {
        dispatch({ type: 'MAGIC_LINK_FAILED', error: data.error ?? 'Something went wrong. Please try again.' });
        return;
      }
      dispatch({ type: 'MAGIC_LINK_SENT' });
    } catch {
      dispatch({ type: 'MAGIC_LINK_FAILED', error: "We couldn't reach the server. Check your connection and try again." });
    }
  }

  if (state.status === 'loading') {
    return <p>Loading…</p>;
  }

  if (
    state.status === 'needsSignIn' ||
    state.status === 'submittingMagicLink' ||
    state.status === 'checkEmail' ||
    state.status === 'magicLinkError'
  ) {
    return (
      <main className="mx-auto flex max-w-md flex-col gap-6 px-6 py-16">
        <h1 className="text-2xl font-bold text-gray-900">Weekly content ideas</h1>
        <SignInPrompt
          state={state}
          introCopy="Sign in with a one-time email link to get your weekly content ideas."
          returnCopy="Click it to continue and we'll bring you right back here."
          onEmailChange={(email) => dispatch({ type: 'EMAIL_CHANGED', email })}
          onSubmitEmail={() => {
            const { email } = state;
            dispatch({ type: 'SUBMIT_EMAIL' });
            void submitMagicLink(email);
          }}
          onResend={() => {
            const { email } = state;
            dispatch({ type: 'RESEND_EMAIL' });
            void submitMagicLink(email);
          }}
          onRetryEmail={() => dispatch({ type: 'RETRY_EMAIL' })}
        />
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
      <h1 className="text-2xl font-bold text-gray-900">Weekly content ideas</h1>
      <p className="text-gray-600">Set your niche once, then get a ranked shortlist of Reel and carousel concepts for the week.</p>

      <div className="flex flex-col gap-3">
        <label htmlFor="ideas-niche" className="flex flex-col gap-1 text-sm font-medium text-gray-700">
          Your niche
          <input
            id="ideas-niche"
            type="text"
            value={state.status === 'ideasReady' ? state.niche : isNicheEditingState(state) ? state.niche : ''}
            onChange={(e) => dispatch({ type: 'NICHE_CHANGED', value: e.target.value })}
            placeholder="e.g. home baking, personal finance for Gen Z"
            disabled={state.status === 'generating' || state.status === 'ideasReady'}
            className="rounded-lg border border-gray-300 px-4 py-2 font-normal disabled:bg-gray-50"
          />
        </label>
        {isNicheEditingState(state) && (
          <button
            type="button"
            onClick={saveNiche}
            disabled={state.status === 'generating'}
            className="self-start rounded-full border border-indigo-600 px-4 py-2 text-sm font-semibold text-indigo-700 disabled:opacity-50"
          >
            Save niche
          </button>
        )}
        {state.status === 'ideasReady' && (
          <button
            type="button"
            onClick={() => dispatch({ type: 'EDIT_NICHE' })}
            className="self-start text-sm text-indigo-700 underline"
          >
            Edit niche
          </button>
        )}
      </div>

      {state.status === 'needsNiche' && state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}

      {state.status === 'readyToGenerate' && (
        <button
          type="button"
          onClick={generate}
          className="self-start rounded-full bg-indigo-600 px-6 py-3 font-semibold text-white hover:bg-indigo-700"
        >
          Get this week&apos;s ideas
        </button>
      )}

      {state.status === 'generating' && (
        <Spinner label={state.stillWorking ? 'Still working — researching your niche…' : 'Generating…'} />
      )}

      {state.status === 'generationFailed' && (
        <div className="flex flex-col gap-2">
          <p role="alert" className="text-sm text-red-600">
            {state.error}
          </p>
          <button
            type="button"
            onClick={generate}
            className="self-start rounded-full bg-indigo-600 px-6 py-3 font-semibold text-white hover:bg-indigo-700"
          >
            Try again
          </button>
        </div>
      )}

      {state.status === 'ideasReady' && (
        <div className="flex flex-col gap-4">
          {state.ideas.map((idea, index) => (
            <article key={index} className="flex flex-col gap-2 rounded-lg border border-gray-200 p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-semibold text-gray-900">{idea.workingTitle}</h2>
                <span className="whitespace-nowrap rounded-full bg-indigo-100 px-3 py-1 text-xs font-medium text-indigo-700">
                  {MEDIUM_LABELS[idea.medium]} · {idea.format}
                </span>
              </div>
              <p className="text-gray-700">{idea.pitch}</p>
              <p className="text-sm text-gray-600">
                <strong>Why it&apos;s hot now:</strong> {idea.whyItsHotNow}
                {idea.sourceUrl && (
                  <>
                    {' — '}
                    <a href={idea.sourceUrl} target="_blank" rel="noreferrer" className="text-indigo-700 underline">
                      source
                    </a>
                  </>
                )}
              </p>
              <p className="text-sm text-gray-600">
                <strong>Why it ranks here:</strong> {idea.whyItRanksHere} ({idea.kpiSignals.join(', ')})
              </p>
              {idea.reelDetails && (
                <p className="text-sm text-gray-500">
                  Reel: ~{idea.reelDetails.suggestedLengthSeconds}s,{' '}
                  {idea.reelDetails.style === 'talking-head' ? 'talking-head' : 'VO over capture'}
                </p>
              )}
              {idea.carouselDetails && (
                <p className="text-sm text-gray-500">
                  Carousel: {idea.carouselDetails.hookFormula} — &ldquo;{idea.carouselDetails.coverLine}&rdquo; (
                  {idea.carouselDetails.slideCount} slides)
                </p>
              )}
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
```

```tsx
// app/page.tsx
import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col items-center gap-6 px-6 py-24 text-center">
      <h1 className="text-4xl font-bold text-gray-900">
        Understand your content, in plain English.
      </h1>
      <p className="text-lg text-gray-600">
        Paste a link to a video or post and get a report on your hook, your retention risk,
        your posting timing, and your format fit &mdash; explained in words you actually
        understand, not jargon.
      </p>
      <Link
        href="/diagnostic"
        className="rounded-full bg-indigo-600 px-8 py-3 text-lg font-semibold text-white hover:bg-indigo-700"
      >
        Run a free diagnostic
      </Link>
      <Link href="/recap" className="text-indigo-700 underline">
        Get your monthly recap card
      </Link>
      <Link href="/ideas" className="text-indigo-700 underline">
        Get weekly content ideas
      </Link>
    </main>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/app/ideas/page.test.tsx tests/unit/app/page.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/ideas/page.tsx tests/unit/app/ideas/page.test.tsx app/page.tsx tests/unit/app/page.test.tsx
git commit -m "feat: add /ideas page and landing page link"
```

---

### Task 6: Playwright E2E smoke test

**Files:**
- Create: `tests/e2e/ideas-smoke.spec.ts`

**Interfaces:**
- Consumes: `/ideas` (Task 5) and the `/api/ideas*` routes (Tasks 2–3), all via mocked network responses
- Produces: nothing further downstream — terminal verification for this plan

- [ ] **Step 1: Write the test**

```ts
// tests/e2e/ideas-smoke.spec.ts
import { test, expect } from '@playwright/test';

test('setting a niche and generating shows the returned idea cards', async ({ page }) => {
  await page.route('**/api/ideas', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ niche: null, digest: null }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        digest: {
          id: 'e2e-digest-1',
          weekStart: '2026-08-10',
          contentIdeas: [
            {
              workingTitle: 'Sourdough Speedrun',
              pitch: 'Bake a loaf in under 2 hours on camera',
              medium: 'reel',
              format: 'Speed Recap',
              whyItsHotNow: 'Sourdough resurgence trending this week',
              sourceUrl: 'https://example.com/a',
              whyItRanksHere: 'High reach from trend-jacking',
              kpiSignals: ['reach'],
              reelDetails: { suggestedLengthSeconds: 60, style: 'talking-head' },
              carouselDetails: null,
            },
          ],
        },
      }),
    });
  });

  await page.route('**/api/ideas/niche', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  await page.goto('/ideas');
  await page.getByLabel(/your niche/i).fill('home baking');
  await page.getByRole('button', { name: /save niche/i }).click();
  await page.getByRole('button', { name: /get this week's ideas/i }).click();

  await expect(page.getByRole('heading', { name: 'Sourdough Speedrun' })).toBeVisible();
  await expect(page.getByText('Bake a loaf in under 2 hours on camera')).toBeVisible();
  await expect(page.getByText(/Speed Recap/)).toBeVisible();
});
```

- [ ] **Step 2: Run the test**

Run: `npx playwright test tests/e2e/ideas-smoke.spec.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/ideas-smoke.spec.ts
git commit -m "test: add Playwright smoke test for the content ideas flow"
```

---

## Verification

After all tasks are complete, run the full suite before considering this plan done:

```bash
npm run typecheck
npm run lint
npx vitest run
npx playwright test
npm run build
```

All five must pass with no errors before this branch is considered mergeable.
