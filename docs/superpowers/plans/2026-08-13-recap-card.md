# Recap Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shareable monthly stats card end to end — a creator saves a public handle/profile URL per platform, generates an on-demand, cached, rate-limited recap of that month's posts, and gets a public, embeddable PNG card plus a shareable page to send to their own audience.

**Architecture:** Two new integration methods (`fetchProfilePosts` on the Apify scraper client, `getChannelUploads` on the YouTube client) pull a bounded window of a creator's recent public posts with no OAuth. A pure aggregation module (`lib/recap/aggregate.ts`) filters those posts to the target calendar month and rolls them into totals + one overall top post. A DI-style handler (`lib/recap/handler.ts`, mirroring `lib/diagnostic/handler.ts`) wires rate-limiting, the monthly-cache check, and the per-platform fetch/aggregate/save flow. `next/og`'s `ImageResponse` renders the PNG on demand from stored JSON — no binary storage, no Playwright. One clarification versus the committed spec: `/recap` (the creator's private, authenticated connect-and-generate page) redirects to `/recap/[id]` on success rather than rendering the card inline itself, and `/recap/[id]` (plus its JSON and image routes) is fully public — this resolves an underspecified interaction between the spec's page-state table and its "public shareable URL" requirement (a link a creator hands to their own audience must work for people who aren't signed in), while keeping every other decision in the spec unchanged.

**Tech Stack:** Next.js 16 (App Router) + TypeScript, `next/og` `ImageResponse` (ships with Next, no new dependency), Supabase (existing `@supabase/supabase-js`/`@supabase/ssr`), Vitest + Testing Library, Playwright. No new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-08-13-recap-card-design.md` (committed at `8721c1b`) — this plan implements every section of that spec, with the one clarification called out above.

## Global Constraints

- No OAuth, no stored access tokens for any platform — a creator connects by saving a public handle/profile URL per platform (spec decision #2).
- Generation is on-demand only — a button, never a scheduled sweep across creators (spec decision #3/#4). One `recap_cards` row per `(profile, month)`, enforced by a DB unique constraint, is the cache: a second generation request in the same month returns the existing row without re-scraping.
- Every profile-level scrape/fetch is bounded (~50 posts) regardless of how prolific the creator is (spec §2.1/§2.2).
- The card is one combined image aggregating every connected platform — never a card per platform (spec decision #5).
- `/recap` owns handle-connection + generation for the signed-in creator; `/recap/[id]` (page, its JSON route, and its image route) is the public, shareable output — deliberately not owner-gated, since it's the artifact a creator hands to other people (this plan's clarification above).
- Follow the existing DI pattern: pure, dependency-injected core logic in `lib/`, thin `route.ts` wrappers that wire real Supabase/integration clients — same shape as `lib/diagnostic/handler.ts` / `app/api/diagnostic/route.ts`.
- A platform that fails to scrape or returns nothing for the month is dropped from the breakdown, recorded in a `warnings` list, and does not block generation unless every connected platform came back empty (spec §2 step 5, §4).
- Rate-limit reuse: `checkAndRecordRateLimit`'s existing per-call overrides (`profileLimit`, `ipLimit`, `windowDays`) — no rate-limiting infra changes needed, only a new `recap_generation` event type and override values (`profileLimit: 5, ipLimit: 10, windowDays: 1`).
- Per `AGENTS.md`, `ImageResponse`'s API surface was confirmed against `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/image-response.md` before this plan was written (imported from `next/og`, current in this Next 16 build) — re-check that file if this plan sits unexecuted long enough for the vendored docs to have moved.
- The Apify/handle-based TikTok/Instagram sourcing built here is a deliberate bridge, not the permanent architecture — confirmed 2026-08-13 (spec decision #7). Do not let a future refactor "simplify" `lib/recap/handler.ts`'s DI boundary around `ScraperClient` in a way that makes swapping `fetchProfilePosts` for an OAuth-backed call harder later.

---

## File Structure

```
supabase/migrations/
  20260814000001_create_recap_cards.sql   # profiles handle columns + recap_cards table + RLS

lib/supabase/types.ts                     # MODIFIED — profiles handle columns, recap_cards table

lib/integrations/
  scraper.ts                              # MODIFIED — adds ProfilePost, fetchProfilePosts to ScraperClient
  youtube.ts                              # MODIFIED — adds getChannelUploads to YouTubeClient

lib/recap/
  types.ts                                # RecapPlatform, RecapHandles, AggregatablePost, PlatformTotals,
                                           #   RecapTopPost, RecapAggregation, RecapCardRow
  aggregate.ts                            # filterPostsToMonth, aggregateRecap (pure)
  handles.ts                              # normalizeHandle, saveRecapHandles (DI)
  handler.ts                              # handleRecapRequest (DI) — the generation pipeline
  page-state.ts                           # pure reducer for app/recap/page.tsx

app/api/recap/
  route.ts                                # GET (bootstrap: handles + this month's card id) + POST (generate)
  handles/route.ts                        # POST — save platform handles
  [id]/route.ts                           # GET — public JSON for a recap card

app/recap/
  page.tsx                                # private: connect handles, generate, redirect to /recap/[id]
  [id]/
    page.tsx                              # public: shows the card image + download
    image/route.tsx                       # public: ImageResponse PNG render

components/... (no changes — reuses existing Spinner.tsx)
app/page.tsx                              # MODIFIED — one added nav link to /recap

tests/unit/supabase/migrations.test.ts    # MODIFIED — new migration assertion
tests/fakes/scraper.fake.ts               # MODIFIED — implements fetchProfilePosts
tests/fakes/youtube.fake.ts               # MODIFIED — implements getChannelUploads
tests/unit/lib/integrations/scraper.test.ts    # MODIFIED — new fetchProfilePosts tests
tests/unit/lib/integrations/youtube.test.ts    # MODIFIED — new getChannelUploads tests
tests/unit/lib/recap/aggregate.test.ts
tests/unit/lib/recap/handles.test.ts
tests/unit/lib/recap/handler.test.ts
tests/unit/lib/recap/page-state.test.ts
tests/unit/app/recap/page.test.tsx
tests/unit/app/page.test.tsx              # MODIFIED — new nav link assertion
tests/e2e/recap-smoke.spec.ts
```

---

### Task 1: SQL migration — `recap_cards` + profile handle columns

**Files:**
- Create: `supabase/migrations/20260814000001_create_recap_cards.sql`
- Modify: `lib/supabase/types.ts`
- Modify: `tests/unit/supabase/migrations.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `public.recap_cards` table, `profiles.youtube_channel_handle`/`tiktok_handle`/`instagram_handle` columns; `Database['public']['Tables']['recap_cards']` type — relied on by every later task that touches Supabase

- [ ] **Step 1: Write the failing test**

Add this `it` block inside the existing `describe('supabase migrations', ...)` in `tests/unit/supabase/migrations.test.ts` (append before the closing `});`):

```ts
  it('includes a migration adding recap platform handles to profiles and a recap_cards table', () => {
    const sql = readMigrationContaining('create_recap_cards');
    expect(sql).toContain('add column youtube_channel_handle text');
    expect(sql).toContain('add column tiktok_handle text');
    expect(sql).toContain('add column instagram_handle text');
    expect(sql).toContain('create table if not exists public.recap_cards');
    expect(sql).toContain('unique (profile_id, month)');
    expect(sql).toContain('"Recap cards are viewable by owner"');
    expect(sql).toContain('"Recap cards are insertable by owner"');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/supabase/migrations.test.ts`
Expected: FAIL with `No migration file matching "create_recap_cards"`

- [ ] **Step 3: Write the migration and update the Database type**

```sql
-- supabase/migrations/20260814000001_create_recap_cards.sql

-- A creator connects by saving a public handle/profile URL per platform —
-- no OAuth token, since these are public data sources. See
-- docs/superpowers/specs/2026-08-13-recap-card-design.md §1.
alter table public.profiles
  add column youtube_channel_handle text,
  add column tiktok_handle text,
  add column instagram_handle text;

-- Stores computed stats only, never a binary image — the card itself is
-- rendered on demand by app/recap/[id]/image/route.tsx from this row's
-- JSON. One row per (profile, month): the unique constraint is what makes
-- generation idempotent and safe to be on-demand (spec §2, generation
-- pipeline step 2).
create table if not exists public.recap_cards (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  month date not null,
  platform_data jsonb not null,
  totals jsonb not null,
  top_post jsonb not null,
  warnings text[] not null default '{}',
  generated_at timestamptz not null default now(),
  unique (profile_id, month)
);

alter table public.recap_cards enable row level security;

create policy "Recap cards are viewable by owner"
  on public.recap_cards for select
  using (auth.uid() = profile_id);

create policy "Recap cards are insertable by owner"
  on public.recap_cards for insert
  with check (auth.uid() = profile_id);
```

Update `lib/supabase/types.ts` — add the three columns to the `profiles` table's `Row`/`Insert`/`Update`, and add a `recap_cards` entry to `Tables`:

```ts
export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          display_name: string | null;
          niche: string | null;
          youtube_channel_handle: string | null;
          tiktok_handle: string | null;
          instagram_handle: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          email: string;
          display_name?: string | null;
          niche?: string | null;
          youtube_channel_handle?: string | null;
          tiktok_handle?: string | null;
          instagram_handle?: string | null;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>;
        Relationships: [];
      };
      diagnostics: {
        Row: {
          id: string;
          profile_id: string;
          platform: 'youtube' | 'tiktok' | 'instagram';
          input_url: string;
          status: 'pending' | 'complete' | 'failed';
          hook_strength_score: number | null;
          retention_risk_score: number | null;
          timing_score: number | null;
          format_fit_score: number | null;
          overall_score: number | null;
          report_json: unknown | null;
          error_message: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          profile_id: string;
          platform: 'youtube' | 'tiktok' | 'instagram';
          input_url: string;
          status?: 'pending' | 'complete' | 'failed';
          hook_strength_score?: number | null;
          retention_risk_score?: number | null;
          timing_score?: number | null;
          format_fit_score?: number | null;
          overall_score?: number | null;
          report_json?: unknown | null;
          error_message?: string | null;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['diagnostics']['Insert']>;
        Relationships: [];
      };
      rate_limit_events: {
        Row: { id: string; profile_id: string | null; ip_hash: string; event_type: string; created_at: string };
        Insert: { id?: string; profile_id?: string | null; ip_hash: string; event_type: string; created_at?: string };
        Update: Partial<Database['public']['Tables']['rate_limit_events']['Insert']>;
        Relationships: [];
      };
      glossary_terms: {
        Row: { id: string; slug: string; term: string; definition: string; example: string; created_at: string };
        Insert: { id?: string; slug: string; term: string; definition: string; example: string; created_at?: string };
        Update: Partial<Database['public']['Tables']['glossary_terms']['Insert']>;
        Relationships: [];
      };
      weekly_digests: {
        Row: { id: string; profile_id: string; week_start: string; content_ideas: unknown | null; sent_at: string | null; created_at: string };
        Insert: { id?: string; profile_id: string; week_start: string; content_ideas?: unknown | null; sent_at?: string | null; created_at?: string };
        Update: Partial<Database['public']['Tables']['weekly_digests']['Insert']>;
        Relationships: [];
      };
      niche_community_sources: {
        Row: { id: string; niche: string; source_type: string; source_identifier: string; last_scraped_at: string | null; created_at: string };
        Insert: { id?: string; niche: string; source_type: string; source_identifier: string; last_scraped_at?: string | null; created_at?: string };
        Update: Partial<Database['public']['Tables']['niche_community_sources']['Insert']>;
        Relationships: [];
      };
      recap_cards: {
        Row: {
          id: string;
          profile_id: string;
          month: string;
          platform_data: unknown;
          totals: unknown;
          top_post: unknown;
          warnings: string[];
          generated_at: string;
        };
        Insert: {
          id?: string;
          profile_id: string;
          month: string;
          platform_data: unknown;
          totals: unknown;
          top_post: unknown;
          warnings?: string[];
          generated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['recap_cards']['Insert']>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      check_and_record_rate_limit: {
        Args: {
          p_profile_id: string | null;
          p_identity_hash: string | null;
          p_ip_hash: string;
          p_event_type: string;
          p_profile_limit: number;
          p_ip_limit: number;
          p_window_start: string;
          p_now: string;
        };
        Returns: { allowed: boolean; reason: string | null; event_id: string | null }[];
      };
      release_rate_limit_event: {
        Args: { p_event_id: string };
        Returns: undefined;
      };
    };
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/supabase/migrations.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260814000001_create_recap_cards.sql lib/supabase/types.ts tests/unit/supabase/migrations.test.ts
git commit -m "feat: add recap_cards table and profile platform-handle columns"
```

---

### Task 2: Scraper — profile-level Apify fetch

**Files:**
- Modify: `lib/integrations/scraper.ts`
- Modify: `tests/fakes/scraper.fake.ts`
- Modify: `tests/unit/lib/integrations/scraper.test.ts`

**Interfaces:**
- Consumes: nothing new (extends the existing `ScraperClient`/`createApifyScraperClient` from Task 15 of the scaffold plan)
- Produces: `ProfilePost`, `ScraperClient.fetchProfilePosts(platform, handle)` — relied on by Task 6 (`lib/recap/handler.ts`)

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/lib/integrations/scraper.test.ts` (inside the existing `describe('createApifyScraperClient', ...)`, before its closing `});`):

```ts
  describe('fetchProfilePosts', () => {
    it('starts an async Apify run, polls until it succeeds, and normalizes the dataset items', async () => {
      const fetchMock = vi
        .fn()
        // start run
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => ({ data: { id: 'run-1', defaultDatasetId: 'dataset-1' } }),
        })
        // poll: still running
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { status: 'RUNNING' } }) })
        // poll: succeeded
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { status: 'SUCCEEDED' } }) })
        // dataset items
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [
            {
              id: '111',
              text: 'Post one',
              createTimeISO: '2026-08-02T10:00:00Z',
              playCount: 1000,
              diggCount: 50,
              commentCount: 5,
              webVideoUrl: 'https://www.tiktok.com/@creator/video/111',
            },
          ],
        });
      vi.stubGlobal('fetch', fetchMock);

      const client = createApifyScraperClient('test-token', { sleep: async () => {} });
      const posts = await client.fetchProfilePosts('tiktok', 'creator');

      expect(posts).toEqual([
        {
          platform: 'tiktok',
          id: '111',
          caption: 'Post one',
          publishedAt: '2026-08-02T10:00:00Z',
          viewCount: 1000,
          likeCount: 50,
          commentCount: 5,
          permalink: 'https://www.tiktok.com/@creator/video/111',
        },
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(String(fetchMock.mock.calls[0][0])).toContain('/acts/clockworks~tiktok-scraper/runs');
      expect(String(fetchMock.mock.calls[1][0])).toContain('/actor-runs/run-1');
      expect(String(fetchMock.mock.calls[3][0])).toContain('/datasets/dataset-1/items');
    });

    it('retries once after a failed run and succeeds on the second attempt', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ data: { id: 'run-1', defaultDatasetId: 'dataset-1' } }) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { status: 'FAILED' } }) })
        .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ data: { id: 'run-2', defaultDatasetId: 'dataset-2' } }) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { status: 'SUCCEEDED' } }) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] });
      vi.stubGlobal('fetch', fetchMock);

      const client = createApifyScraperClient('test-token', { sleep: async () => {}, retryAttempts: 1 });
      const posts = await client.fetchProfilePosts('tiktok', 'creator');

      expect(posts).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(5);
    });

    it('throws after exhausting all retry attempts', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
      vi.stubGlobal('fetch', fetchMock);

      const client = createApifyScraperClient('test-token', { sleep: async () => {}, retryAttempts: 1 });
      await expect(client.fetchProfilePosts('instagram', 'creator')).rejects.toThrow();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/integrations/scraper.test.ts`
Expected: FAIL with `client.fetchProfilePosts is not a function`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/integrations/scraper.ts
export interface SocialPostMetadata {
  platform: 'tiktok' | 'instagram';
  id: string;
  caption: string;
  publishedAt: string;
  durationSeconds: number;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  // Only populated for TikTok — Apify's TikTok scraper exposes shareCount
  // and collectCount (saves), but Instagram doesn't publicly expose either,
  // even to scrapers. See
  // docs/superpowers/specs/2026-08-13-diagnostic-benchmark-sources.md.
  shareCount?: number;
  saveCount?: number;
}

export interface ProfilePost {
  platform: 'tiktok' | 'instagram';
  id: string;
  caption: string;
  publishedAt: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  permalink: string;
}

export interface ScraperClient {
  detectPlatform(url: string): 'tiktok' | 'instagram' | null;
  fetchPost(url: string): Promise<SocialPostMetadata>;
  /**
   * Bounded, async-run profile scrape — distinct from fetchPost's sync
   * single-post call because a profile crawl runs long enough to risk the
   * sync endpoint's response-timeout ceiling. See spec §2.1.
   */
  fetchProfilePosts(platform: 'tiktok' | 'instagram', handle: string): Promise<ProfilePost[]>;
}

export function detectSocialPlatform(url: string): 'tiktok' | 'instagram' | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('tiktok.com')) return 'tiktok';
    if (parsed.hostname.includes('instagram.com')) return 'instagram';
    return null;
  } catch {
    return null;
  }
}

const APIFY_ACTORS: Record<'tiktok' | 'instagram', string> = {
  tiktok: 'clockworks~tiktok-scraper',
  instagram: 'apify~instagram-scraper',
};

// Bounds cost per creator regardless of how prolific they are — the
// month-filter in lib/recap/aggregate.ts then narrows this down further.
// See spec §2.1.
const PROFILE_SCRAPE_RESULTS_LIMIT = 50;
const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_MAX_POLL_ATTEMPTS = 30;
const DEFAULT_RETRY_ATTEMPTS = 1;

export interface ApifyScraperOptions {
  pollIntervalMs?: number;
  maxPollAttempts?: number;
  retryAttempts?: number;
  /** Injectable for tests — defaults to a real setTimeout-based delay. */
  sleep?: (ms: number) => Promise<void>;
}

function profileUrlFor(platform: 'tiktok' | 'instagram', handle: string): string {
  const cleanHandle = handle.replace(/^@/, '');
  return platform === 'tiktok'
    ? `https://www.tiktok.com/@${cleanHandle}`
    : `https://www.instagram.com/${cleanHandle}/`;
}

function normalizeProfilePost(platform: 'tiktok' | 'instagram', item: Record<string, unknown>): ProfilePost {
  return {
    platform,
    id: String(item.id ?? item.videoId ?? item.shortCode ?? ''),
    caption: String(item.text ?? item.caption ?? ''),
    publishedAt: String(item.createTimeISO ?? item.timestamp ?? ''),
    viewCount: Number(item.playCount ?? item.videoViewCount ?? item.viewCount ?? 0),
    likeCount: Number(item.diggCount ?? item.likesCount ?? item.likeCount ?? 0),
    commentCount: Number(item.commentCount ?? 0),
    permalink: String(item.webVideoUrl ?? item.url ?? item.permalink ?? ''),
  };
}

async function runApifyActorAndWait(params: {
  actorId: string;
  apiToken: string;
  input: Record<string, unknown>;
  pollIntervalMs: number;
  maxPollAttempts: number;
  sleep: (ms: number) => Promise<void>;
}): Promise<unknown[]> {
  const startResponse = await fetch(`https://api.apify.com/v2/acts/${params.actorId}/runs?token=${params.apiToken}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params.input),
  });
  if (!startResponse.ok) {
    throw new Error(`Apify run start failed with status ${startResponse.status}`);
  }
  const startData = await startResponse.json();
  const runId = startData.data.id;
  const datasetId = startData.data.defaultDatasetId;

  for (let attempt = 0; attempt < params.maxPollAttempts; attempt++) {
    const statusResponse = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${params.apiToken}`);
    if (!statusResponse.ok) {
      throw new Error(`Apify run status check failed with status ${statusResponse.status}`);
    }
    const statusData = await statusResponse.json();
    const status = statusData.data.status;

    if (status === 'SUCCEEDED') {
      const datasetResponse = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${params.apiToken}`);
      if (!datasetResponse.ok) {
        throw new Error(`Apify dataset fetch failed with status ${datasetResponse.status}`);
      }
      return datasetResponse.json();
    }
    if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
      throw new Error(`Apify run ended with status ${status}`);
    }
    await params.sleep(params.pollIntervalMs);
  }
  throw new Error('Apify run did not finish within the polling window');
}

export function createApifyScraperClient(apiToken: string, options: ApifyScraperOptions = {}): ScraperClient {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxPollAttempts = options.maxPollAttempts ?? DEFAULT_MAX_POLL_ATTEMPTS;
  const retryAttempts = options.retryAttempts ?? DEFAULT_RETRY_ATTEMPTS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  return {
    detectPlatform: detectSocialPlatform,
    async fetchPost(url: string): Promise<SocialPostMetadata> {
      const platform = detectSocialPlatform(url);
      if (!platform) {
        throw new Error(`Unsupported social URL: ${url}`);
      }
      const actorId = APIFY_ACTORS[platform];
      const runUrl = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${apiToken}`;
      const response = await fetch(runUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startUrls: [{ url }] }),
      });
      if (!response.ok) {
        throw new Error(`Apify scrape failed with status ${response.status}`);
      }
      const items = await response.json();
      const item = items[0];
      if (!item) {
        throw new Error(`Apify returned no data for ${url}`);
      }
      return {
        platform,
        id: String(item.id ?? item.videoId ?? item.shortCode ?? url),
        caption: item.text ?? item.caption ?? '',
        publishedAt: item.createTimeISO ?? item.timestamp ?? new Date().toISOString(),
        durationSeconds: Number(item.videoDuration ?? item.duration ?? 0),
        viewCount: Number(item.playCount ?? item.videoViewCount ?? item.viewCount ?? 0),
        likeCount: Number(item.diggCount ?? item.likesCount ?? item.likeCount ?? 0),
        commentCount: Number(item.commentCount ?? 0),
        shareCount: platform === 'tiktok' && item.shareCount !== undefined ? Number(item.shareCount) : undefined,
        saveCount: platform === 'tiktok' && item.collectCount !== undefined ? Number(item.collectCount) : undefined,
      };
    },
    async fetchProfilePosts(platform: 'tiktok' | 'instagram', handle: string): Promise<ProfilePost[]> {
      const actorId = APIFY_ACTORS[platform];
      let lastError: unknown;
      for (let attempt = 0; attempt <= retryAttempts; attempt++) {
        try {
          const items = await runApifyActorAndWait({
            actorId,
            apiToken,
            input: {
              startUrls: [{ url: profileUrlFor(platform, handle) }],
              resultsLimit: PROFILE_SCRAPE_RESULTS_LIMIT,
            },
            pollIntervalMs,
            maxPollAttempts,
            sleep,
          });
          return items.map((item) => normalizeProfilePost(platform, item as Record<string, unknown>));
        } catch (err) {
          lastError = err;
          if (attempt < retryAttempts) {
            await sleep(pollIntervalMs);
          }
        }
      }
      throw lastError;
    },
  };
}
```

Update `tests/fakes/scraper.fake.ts` so the fake still satisfies the (now larger) `ScraperClient` interface — every existing test using `createFakeScraperClient` (the diagnostic handler tests) would otherwise fail to type-check:

```ts
// tests/fakes/scraper.fake.ts
import type { ScraperClient, SocialPostMetadata, ProfilePost } from '@/lib/integrations/scraper';
import { detectSocialPlatform } from '@/lib/integrations/scraper';

export function createFakeScraperClient(
  overrides: Partial<SocialPostMetadata> = {},
  profilePosts: ProfilePost[] = []
): ScraperClient {
  const metadata: SocialPostMetadata = {
    platform: 'tiktok',
    id: 'fake-post-id',
    caption: 'Wait for it... #hook',
    publishedAt: '2026-08-05T19:00:00Z',
    durationSeconds: 28,
    viewCount: 12000,
    likeCount: 900,
    commentCount: 60,
    ...overrides,
  };
  return {
    detectPlatform: detectSocialPlatform,
    fetchPost: async () => metadata,
    fetchProfilePosts: async () => profilePosts,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/integrations/scraper.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/integrations/scraper.ts tests/fakes/scraper.fake.ts tests/unit/lib/integrations/scraper.test.ts
git commit -m "feat: add profile-level Apify scrape to the scraper client"
```

---

### Task 3: YouTube — channel uploads via existing API key

**Files:**
- Modify: `lib/integrations/youtube.ts`
- Modify: `tests/fakes/youtube.fake.ts`
- Modify: `tests/unit/lib/integrations/youtube.test.ts`

**Interfaces:**
- Consumes: nothing new (extends the existing `YouTubeClient`/`createYouTubeClient` from Task 14 of the scaffold plan)
- Produces: `YouTubeClient.getChannelUploads(handle, maxResults?)` — relied on by Task 6 (`lib/recap/handler.ts`)

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/lib/integrations/youtube.test.ts` (inside `describe('createYouTubeClient', ...)`, before its closing `});`):

```ts
  describe('getChannelUploads', () => {
    it('resolves the uploads playlist by handle, then fetches and normalizes recent videos', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ items: [{ contentDetails: { relatedPlaylists: { uploads: 'UUuploads1' } } }] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ items: [{ contentDetails: { videoId: 'vid1' } }] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              {
                snippet: { title: 'Video one', description: '', publishedAt: '2026-08-03T00:00:00Z', tags: [] },
                statistics: { viewCount: '2000', likeCount: '150', commentCount: '20' },
                contentDetails: { duration: 'PT1M' },
              },
            ],
          }),
        });
      vi.stubGlobal('fetch', fetchMock);

      const client = createYouTubeClient('test-api-key');
      const videos = await client.getChannelUploads('@creator');

      expect(videos).toEqual([
        {
          id: 'vid1',
          title: 'Video one',
          description: '',
          publishedAt: '2026-08-03T00:00:00Z',
          durationSeconds: 60,
          viewCount: 2000,
          likeCount: 150,
          commentCount: 20,
          tags: [],
        },
      ]);
      expect(String(fetchMock.mock.calls[0][0])).toContain('forHandle=%40creator');
      expect(String(fetchMock.mock.calls[1][0])).toContain('playlistId=UUuploads1');
    });

    it('throws when no channel is found for the handle', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ items: [] }) }));
      const client = createYouTubeClient('test-api-key');
      await expect(client.getChannelUploads('missing-handle')).rejects.toThrow('No YouTube channel found');
    });

    it('returns an empty array when the channel has no uploads', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ items: [{ contentDetails: { relatedPlaylists: { uploads: 'UUuploads1' } } }] }),
        })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ items: [] }) });
      vi.stubGlobal('fetch', fetchMock);

      const client = createYouTubeClient('test-api-key');
      const videos = await client.getChannelUploads('@creator');
      expect(videos).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/integrations/youtube.test.ts`
Expected: FAIL with `client.getChannelUploads is not a function`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/integrations/youtube.ts
export interface VideoMetadata {
  id: string;
  title: string;
  description: string;
  publishedAt: string;
  durationSeconds: number;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  tags: string[];
}

export interface YouTubeClient {
  extractVideoId(url: string): string | null;
  getVideoMetadata(videoId: string): Promise<VideoMetadata>;
  /**
   * Public channel uploads — no OAuth needed, works off the same API key
   * as getVideoMetadata. Bounded to maxResults regardless of channel size;
   * callers filter further to a target month. See spec §2.2.
   */
  getChannelUploads(handle: string, maxResults?: number): Promise<VideoMetadata[]>;
}

export function extractYouTubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'youtu.be') {
      return parsed.pathname.slice(1) || null;
    }
    if (parsed.hostname.includes('youtube.com')) {
      if (parsed.pathname === '/watch') {
        return parsed.searchParams.get('v');
      }
      if (parsed.pathname.startsWith('/shorts/')) {
        return parsed.pathname.split('/')[2] ?? null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function parseIso8601Duration(iso: string): number {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!match) return 0;
  const [, hours, minutes, seconds] = match;
  return (Number(hours) || 0) * 3600 + (Number(minutes) || 0) * 60 + (Number(seconds) || 0);
}

function mapVideoItem(item: {
  id: string;
  snippet: { title: string; description: string; publishedAt: string; tags?: string[] };
  statistics: { viewCount?: string; likeCount?: string; commentCount?: string };
  contentDetails: { duration: string };
}): VideoMetadata {
  return {
    id: item.id,
    title: item.snippet.title,
    description: item.snippet.description,
    publishedAt: item.snippet.publishedAt,
    durationSeconds: parseIso8601Duration(item.contentDetails.duration),
    viewCount: Number(item.statistics.viewCount ?? 0),
    likeCount: Number(item.statistics.likeCount ?? 0),
    commentCount: Number(item.statistics.commentCount ?? 0),
    tags: item.snippet.tags ?? [],
  };
}

async function fetchYouTubeJson(url: URL): Promise<any> {
  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`YouTube API request failed with status ${response.status}`);
  }
  return response.json();
}

const CHANNEL_UPLOADS_MAX_RESULTS = 50;

export function createYouTubeClient(apiKey: string): YouTubeClient {
  return {
    extractVideoId: extractYouTubeVideoId,
    async getVideoMetadata(videoId: string): Promise<VideoMetadata> {
      const url = new URL('https://www.googleapis.com/youtube/v3/videos');
      url.searchParams.set('id', videoId);
      url.searchParams.set('part', 'snippet,statistics,contentDetails');
      url.searchParams.set('key', apiKey);

      const data = await fetchYouTubeJson(url);
      const item = data.items?.[0];
      if (!item) {
        throw new Error(`No YouTube video found for id ${videoId}`);
      }
      return mapVideoItem({ ...item, id: videoId });
    },
    async getChannelUploads(handle: string, maxResults = CHANNEL_UPLOADS_MAX_RESULTS): Promise<VideoMetadata[]> {
      const cleanHandle = handle.startsWith('@') ? handle : `@${handle}`;

      const channelsUrl = new URL('https://www.googleapis.com/youtube/v3/channels');
      channelsUrl.searchParams.set('part', 'contentDetails');
      channelsUrl.searchParams.set('forHandle', cleanHandle);
      channelsUrl.searchParams.set('key', apiKey);
      const channelsData = await fetchYouTubeJson(channelsUrl);
      const channel = channelsData.items?.[0];
      if (!channel) {
        throw new Error(`No YouTube channel found for handle ${handle}`);
      }
      const uploadsPlaylistId = channel.contentDetails.relatedPlaylists.uploads;

      const playlistUrl = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
      playlistUrl.searchParams.set('part', 'contentDetails');
      playlistUrl.searchParams.set('playlistId', uploadsPlaylistId);
      playlistUrl.searchParams.set('maxResults', String(maxResults));
      playlistUrl.searchParams.set('key', apiKey);
      const playlistData = await fetchYouTubeJson(playlistUrl);
      const videoIds: string[] = (playlistData.items ?? []).map((i: any) => i.contentDetails.videoId);
      if (videoIds.length === 0) return [];

      const videosUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
      videosUrl.searchParams.set('id', videoIds.join(','));
      videosUrl.searchParams.set('part', 'snippet,statistics,contentDetails');
      videosUrl.searchParams.set('key', apiKey);
      const videosData = await fetchYouTubeJson(videosUrl);
      return (videosData.items ?? []).map(mapVideoItem);
    },
  };
}
```

Update `tests/fakes/youtube.fake.ts` so the fake still satisfies the (now larger) `YouTubeClient` interface:

```ts
// tests/fakes/youtube.fake.ts
import type { YouTubeClient, VideoMetadata } from '@/lib/integrations/youtube';

export function createFakeYouTubeClient(
  overrides: Partial<VideoMetadata> = {},
  channelUploads: VideoMetadata[] = []
): YouTubeClient {
  const metadata: VideoMetadata = {
    id: 'fake-video-id',
    title: 'How to hook viewers in 3 seconds',
    description: 'A tutorial about hooks',
    publishedAt: '2026-08-05T19:00:00Z',
    durationSeconds: 180,
    viewCount: 5000,
    likeCount: 400,
    commentCount: 50,
    tags: ['tutorial'],
    ...overrides,
  };
  return {
    extractVideoId: (url: string) => (url.includes('youtube') ? 'fake-video-id' : null),
    getVideoMetadata: async () => metadata,
    getChannelUploads: async () => channelUploads,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/integrations/youtube.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/integrations/youtube.ts tests/fakes/youtube.fake.ts tests/unit/lib/integrations/youtube.test.ts
git commit -m "feat: add channel-uploads lookup to the YouTube client"
```

---

### Task 4: Recap aggregation (pure)

**Files:**
- Create: `lib/recap/types.ts`
- Create: `lib/recap/aggregate.ts`
- Test: `tests/unit/lib/recap/aggregate.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `RecapPlatform`, `RecapHandles`, `AggregatablePost`, `PlatformTotals`, `RecapTopPost`, `RecapAggregation`, `RecapCardRow` (types); `filterPostsToMonth(posts, target)`, `aggregateRecap(postsByPlatform)` — relied on by Task 6 (`lib/recap/handler.ts`) and every route that shapes a `recap_cards` row

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lib/recap/aggregate.test.ts
import { describe, it, expect } from 'vitest';
import { filterPostsToMonth, aggregateRecap } from '@/lib/recap/aggregate';
import type { AggregatablePost } from '@/lib/recap/types';

function post(overrides: Partial<AggregatablePost> = {}): AggregatablePost {
  return {
    platform: 'tiktok',
    captionOrTitle: 'A post',
    publishedAt: '2026-08-10T00:00:00Z',
    viewCount: 100,
    likeCount: 10,
    commentCount: 1,
    permalink: 'https://tiktok.com/@x/video/1',
    ...overrides,
  };
}

describe('filterPostsToMonth', () => {
  it('keeps posts published within the target month', () => {
    const posts = [post({ publishedAt: '2026-08-01T00:00:00Z' }), post({ publishedAt: '2026-08-31T23:59:00Z' })];
    expect(filterPostsToMonth(posts, { year: 2026, month: 8 })).toHaveLength(2);
  });

  it('excludes posts published outside the target month', () => {
    const posts = [post({ publishedAt: '2026-07-31T23:59:00Z' }), post({ publishedAt: '2026-09-01T00:00:00Z' })];
    expect(filterPostsToMonth(posts, { year: 2026, month: 8 })).toHaveLength(0);
  });

  it('excludes posts with an unparseable or blank date rather than including them by default', () => {
    const posts = [post({ publishedAt: '' }), post({ publishedAt: 'not-a-date' })];
    expect(filterPostsToMonth(posts, { year: 2026, month: 8 })).toHaveLength(0);
  });
});

describe('aggregateRecap', () => {
  it('sums totals across platforms and picks the single highest-view post as the overall top post', () => {
    const result = aggregateRecap({
      youtube: [post({ platform: 'youtube', viewCount: 500, likeCount: 40, commentCount: 5, captionOrTitle: 'YT video' })],
      tiktok: [
        post({ platform: 'tiktok', viewCount: 900, likeCount: 80, commentCount: 10, captionOrTitle: 'TikTok hit' }),
        post({ platform: 'tiktok', viewCount: 100, likeCount: 5, commentCount: 1 }),
      ],
    });

    expect(result.totals).toEqual({ views: 1500, likes: 125, comments: 16, postCount: 3 });
    expect(result.platformData.youtube).toEqual({ views: 500, likes: 40, comments: 5, postCount: 1 });
    expect(result.platformData.tiktok).toEqual({ views: 1000, likes: 85, comments: 11, postCount: 2 });
    expect(result.topPost).toEqual({
      platform: 'tiktok',
      captionOrTitle: 'TikTok hit',
      viewCount: 900,
      permalink: 'https://tiktok.com/@x/video/1',
    });
  });

  it('drops a platform entirely when it has no posts, rather than including a zeroed entry', () => {
    const result = aggregateRecap({ youtube: [post({ platform: 'youtube' })], tiktok: [] });
    expect(result.platformData.tiktok).toBeUndefined();
  });

  it('returns a null top post and zeroed totals when every platform is empty', () => {
    const result = aggregateRecap({});
    expect(result.topPost).toBeNull();
    expect(result.totals).toEqual({ views: 0, likes: 0, comments: 0, postCount: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/recap/aggregate.test.ts`
Expected: FAIL with `Cannot find module '@/lib/recap/aggregate'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/recap/types.ts
export type RecapPlatform = 'youtube' | 'tiktok' | 'instagram';

export interface RecapHandles {
  youtube: string | null;
  tiktok: string | null;
  instagram: string | null;
}

export interface AggregatablePost {
  platform: RecapPlatform;
  captionOrTitle: string;
  publishedAt: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  permalink: string;
}

export interface PlatformTotals {
  views: number;
  likes: number;
  comments: number;
  postCount: number;
}

export interface RecapTopPost {
  platform: RecapPlatform;
  captionOrTitle: string;
  viewCount: number;
  permalink: string;
}

export interface RecapAggregation {
  platformData: Partial<Record<RecapPlatform, PlatformTotals>>;
  totals: PlatformTotals;
  topPost: RecapTopPost | null;
}

export interface RecapCardRow {
  id: string;
  profileId: string;
  month: string;
  platformData: Partial<Record<RecapPlatform, PlatformTotals>>;
  totals: PlatformTotals;
  topPost: RecapTopPost;
  warnings: string[];
  generatedAt: string;
}
```

```ts
// lib/recap/aggregate.ts
import type { AggregatablePost, PlatformTotals, RecapAggregation, RecapPlatform } from './types';

export function filterPostsToMonth(
  posts: AggregatablePost[],
  target: { year: number; month: number }
): AggregatablePost[] {
  return posts.filter((post) => {
    if (!post.publishedAt) return false;
    const date = new Date(post.publishedAt);
    if (Number.isNaN(date.getTime())) return false;
    return date.getUTCFullYear() === target.year && date.getUTCMonth() + 1 === target.month;
  });
}

export function aggregateRecap(
  postsByPlatform: Partial<Record<RecapPlatform, AggregatablePost[]>>
): RecapAggregation {
  const platformData: RecapAggregation['platformData'] = {};
  const totals: PlatformTotals = { views: 0, likes: 0, comments: 0, postCount: 0 };
  let topPost: RecapAggregation['topPost'] = null;

  for (const platform of Object.keys(postsByPlatform) as RecapPlatform[]) {
    const posts = postsByPlatform[platform];
    if (!posts || posts.length === 0) continue;

    const views = posts.reduce((sum, p) => sum + p.viewCount, 0);
    const likes = posts.reduce((sum, p) => sum + p.likeCount, 0);
    const comments = posts.reduce((sum, p) => sum + p.commentCount, 0);
    platformData[platform] = { views, likes, comments, postCount: posts.length };

    totals.views += views;
    totals.likes += likes;
    totals.comments += comments;
    totals.postCount += posts.length;

    for (const post of posts) {
      if (!topPost || post.viewCount > topPost.viewCount) {
        topPost = { platform, captionOrTitle: post.captionOrTitle, viewCount: post.viewCount, permalink: post.permalink };
      }
    }
  }

  return { platformData, totals, topPost };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/recap/aggregate.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/recap/types.ts lib/recap/aggregate.ts tests/unit/lib/recap/aggregate.test.ts
git commit -m "feat: add recap types and pure month-filter/aggregation logic"
```

---

### Task 5: Handle connection — normalize/save + route

**Files:**
- Create: `lib/recap/handles.ts`
- Create: `app/api/recap/handles/route.ts`
- Test: `tests/unit/lib/recap/handles.test.ts`

**Interfaces:**
- Consumes: `RecapPlatform` from `@/lib/recap/types` (Task 4)
- Produces: `normalizeHandle(platform, rawInput)`, `SaveHandlesDeps`, `SaveHandlesParams`, `saveRecapHandles(deps, params)` — relied on by Task 10 (`app/recap/page.tsx`, via the route below)

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lib/recap/handles.test.ts
import { describe, it, expect, vi } from 'vitest';
import { normalizeHandle, saveRecapHandles } from '@/lib/recap/handles';

describe('normalizeHandle', () => {
  it('accepts a bare handle with or without a leading @', () => {
    expect(normalizeHandle('tiktok', 'creator')).toBe('creator');
    expect(normalizeHandle('tiktok', '@creator')).toBe('creator');
  });

  it('extracts the handle from a full profile URL', () => {
    expect(normalizeHandle('tiktok', 'https://www.tiktok.com/@creator')).toBe('creator');
    expect(normalizeHandle('instagram', 'https://www.instagram.com/creator/')).toBe('creator');
    expect(normalizeHandle('youtube', 'https://www.youtube.com/@creator')).toBe('creator');
  });

  it('rejects a URL for the wrong platform', () => {
    expect(normalizeHandle('tiktok', 'https://www.instagram.com/creator')).toBeNull();
  });

  it('rejects empty or invalid input', () => {
    expect(normalizeHandle('tiktok', '   ')).toBeNull();
    expect(normalizeHandle('tiktok', 'not a valid handle!')).toBeNull();
  });
});

describe('saveRecapHandles', () => {
  it('rejects an invalid handle before calling the update', async () => {
    const updateProfileHandles = vi.fn();
    const result = await saveRecapHandles({ updateProfileHandles }, { profileId: 'p1', tiktok: 'not a valid handle!' });
    expect(result.status).toBe(400);
    expect(updateProfileHandles).not.toHaveBeenCalled();
  });

  it('rejects when no platform is provided at all', async () => {
    const updateProfileHandles = vi.fn();
    const result = await saveRecapHandles({ updateProfileHandles }, { profileId: 'p1' });
    expect(result.status).toBe(400);
    expect(updateProfileHandles).not.toHaveBeenCalled();
  });

  it('normalizes and saves the provided handles, treating an empty string as clearing that platform', async () => {
    const updateProfileHandles = vi.fn().mockResolvedValue(undefined);
    const result = await saveRecapHandles(
      { updateProfileHandles },
      { profileId: 'p1', youtube: '@creator', tiktok: '' }
    );
    expect(result.status).toBe(200);
    expect(updateProfileHandles).toHaveBeenCalledWith('p1', { youtube: 'creator', tiktok: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/recap/handles.test.ts`
Expected: FAIL with `Cannot find module '@/lib/recap/handles'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/recap/handles.ts
import type { RecapHandles, RecapPlatform } from './types';

const HANDLE_HOSTS: Record<RecapPlatform, string[]> = {
  youtube: ['youtube.com', 'youtu.be'],
  tiktok: ['tiktok.com'],
  instagram: ['instagram.com'],
};

export function normalizeHandle(platform: RecapPlatform, rawInput: string): string | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (!HANDLE_HOSTS[platform].some((host) => parsed.hostname.includes(host))) return null;
    const segments = parsed.pathname.split('/').filter(Boolean);
    const handleSegment = segments.find((s) => s.startsWith('@')) ?? segments[0];
    if (!handleSegment) return null;
    return handleSegment.replace(/^@/, '');
  } catch {
    // Not a URL — treat as a bare handle.
    const bare = trimmed.replace(/^@/, '');
    return /^[a-zA-Z0-9._-]+$/.test(bare) ? bare : null;
  }
}

export interface SaveHandlesDeps {
  updateProfileHandles: (profileId: string, handles: Partial<RecapHandles>) => Promise<void>;
}

export interface SaveHandlesParams {
  profileId: string;
  youtube?: string;
  tiktok?: string;
  instagram?: string;
}

export interface SaveHandlesResult {
  status: number;
  body: { ok: true } | { error: string };
}

const PLATFORMS: RecapPlatform[] = ['youtube', 'tiktok', 'instagram'];

export async function saveRecapHandles(deps: SaveHandlesDeps, params: SaveHandlesParams): Promise<SaveHandlesResult> {
  const updates: Partial<RecapHandles> = {};

  for (const platform of PLATFORMS) {
    const raw = params[platform];
    if (raw === undefined) continue;
    if (raw === '') {
      updates[platform] = null;
      continue;
    }
    const normalized = normalizeHandle(platform, raw);
    if (!normalized) {
      return { status: 400, body: { error: `That doesn't look like a valid ${platform} handle or profile URL.` } };
    }
    updates[platform] = normalized;
  }

  if (Object.keys(updates).length === 0) {
    return { status: 400, body: { error: 'At least one platform handle is required.' } };
  }

  await deps.updateProfileHandles(params.profileId, updates);
  return { status: 200, body: { ok: true } };
}
```

```ts
// app/api/recap/handles/route.ts
import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { saveRecapHandles } from '@/lib/recap/handles';

export async function POST(request: Request) {
  const body = (await request.json()) as { youtube?: string; tiktok?: string; instagram?: string };

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'You must be signed in to connect your platforms.' }, { status: 401 });
  }

  const serviceClient = createSupabaseServiceRoleClient();
  const result = await saveRecapHandles(
    {
      updateProfileHandles: async (profileId, handles) => {
        const { error } = await serviceClient
          .from('profiles')
          .update({
            ...(handles.youtube !== undefined ? { youtube_channel_handle: handles.youtube } : {}),
            ...(handles.tiktok !== undefined ? { tiktok_handle: handles.tiktok } : {}),
            ...(handles.instagram !== undefined ? { instagram_handle: handles.instagram } : {}),
          })
          .eq('id', profileId);
        if (error) {
          throw new Error(`Failed to save platform handles: ${error.message}`);
        }
      },
    },
    { profileId: user.id, ...body }
  );

  return NextResponse.json(result.body, { status: result.status });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/recap/handles.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/recap/handles.ts app/api/recap/handles/route.ts tests/unit/lib/recap/handles.test.ts
git commit -m "feat: add platform handle validation, save logic, and POST /api/recap/handles"
```

---

### Task 6: Recap generation handler + `/api/recap` route

**Files:**
- Create: `lib/recap/handler.ts`
- Create: `app/api/recap/route.ts`
- Test: `tests/unit/lib/recap/handler.test.ts`

**Interfaces:**
- Consumes: `RateLimitStore`, `checkAndRecordRateLimit`, `releaseRateLimitEventIfNeeded`, `hashIp` from `@/lib/rate-limit` (existing); `YouTubeClient` (Task 3); `ScraperClient` (Task 2); `filterPostsToMonth`, `aggregateRecap` from `@/lib/recap/aggregate` (Task 4); `RecapHandles`, `RecapCardRow`, `AggregatablePost` from `@/lib/recap/types` (Task 4)
- Produces: `RECAP_GENERATION_PROFILE_LIMIT`, `RECAP_GENERATION_IP_LIMIT`, `RecapHandlerDeps`, `RecapRequestContext`, `handleRecapRequest(deps, context)` — relied on by Task 10 (`app/recap/page.tsx`, via the route below)

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lib/recap/handler.test.ts
import { describe, it, expect, vi } from 'vitest';
import { handleRecapRequest, RECAP_GENERATION_PROFILE_LIMIT } from '@/lib/recap/handler';
import { createInMemoryRateLimitStore } from '../../../fakes/rate-limit-store.fake';
import { createFakeYouTubeClient } from '../../../fakes/youtube.fake';
import { createFakeScraperClient } from '../../../fakes/scraper.fake';
import type { RecapCardRow, RecapHandles } from '@/lib/recap/types';

function makeDeps(overrides: Partial<Parameters<typeof handleRecapRequest>[0]> = {}) {
  const savedCards: RecapCardRow[] = [];
  return {
    rateLimitStore: createInMemoryRateLimitStore(),
    youtubeClient: createFakeYouTubeClient(),
    scraperClient: createFakeScraperClient(),
    ipSalt: 'test-salt',
    getProfileHandles: async (): Promise<RecapHandles> => ({ youtube: 'creator', tiktok: null, instagram: null }),
    getExistingRecapCard: async () => null,
    saveRecapCard: async (params) => {
      const row: RecapCardRow = { id: `card-${savedCards.length + 1}`, profileId: params.profileId, month: params.month, platformData: params.platformData, totals: params.totals, topPost: params.topPost, warnings: params.warnings, generatedAt: '2026-08-13T00:00:00Z' };
      savedCards.push(row);
      return row;
    },
    ...overrides,
  };
}

const NOW = new Date('2026-08-13T12:00:00Z');

describe('handleRecapRequest', () => {
  it('rejects requests without a signed-in profile', async () => {
    const result = await handleRecapRequest(makeDeps(), { profileId: null, ip: '203.0.113.1', now: NOW });
    expect(result.status).toBe(401);
  });

  it('rejects when no platform handle is connected', async () => {
    const deps = makeDeps({ getProfileHandles: async () => ({ youtube: null, tiktok: null, instagram: null }) });
    const result = await handleRecapRequest(deps, { profileId: 'p1', ip: '203.0.113.1', now: NOW });
    expect(result.status).toBe(400);
  });

  it('returns the existing card for this month without scraping again', async () => {
    const scraperClient = createFakeScraperClient();
    const fetchProfilePostsSpy = vi.spyOn(scraperClient, 'fetchProfilePosts');
    const existing: RecapCardRow = {
      id: 'card-existing', profileId: 'p1', month: '2026-08-01',
      platformData: {}, totals: { views: 0, likes: 0, comments: 0, postCount: 0 },
      topPost: { platform: 'youtube', captionOrTitle: 'x', viewCount: 0, permalink: '' },
      warnings: [], generatedAt: '2026-08-01T00:00:00Z',
    };
    const deps = makeDeps({ scraperClient, getExistingRecapCard: async () => existing });

    const result = await handleRecapRequest(deps, { profileId: 'p1', ip: '203.0.113.1', now: NOW });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ recapCard: existing });
    expect(fetchProfilePostsSpy).not.toHaveBeenCalled();
  });

  it('aggregates posts from every connected platform and saves a new card', async () => {
    const youtubeClient = createFakeYouTubeClient(
      {},
      [
        {
          id: 'v1', title: 'YT this month', description: '', publishedAt: '2026-08-05T00:00:00Z',
          durationSeconds: 60, viewCount: 3000, likeCount: 200, commentCount: 10, tags: [],
        },
      ]
    );
    const deps = makeDeps({
      youtubeClient,
      getProfileHandles: async () => ({ youtube: 'creator', tiktok: 'creator', instagram: null }),
      scraperClient: createFakeScraperClient({}, [
        { platform: 'tiktok', id: 't1', caption: 'TikTok this month', publishedAt: '2026-08-06T00:00:00Z', viewCount: 9000, likeCount: 500, commentCount: 30, permalink: 'https://tiktok.com/@creator/video/t1' },
      ]),
    });

    const result = await handleRecapRequest(deps, { profileId: 'p1', ip: '203.0.113.1', now: NOW });
    expect(result.status).toBe(200);
    const body = result.body as { recapCard: RecapCardRow };
    expect(body.recapCard.totals).toEqual({ views: 12000, likes: 700, comments: 40, postCount: 2 });
    expect(body.recapCard.topPost.platform).toBe('tiktok');
    expect(body.recapCard.warnings).toEqual([]);
  });

  it('records a warning and continues when one platform fails, instead of failing the whole request', async () => {
    const scraperClient = createFakeScraperClient({}, [
      { platform: 'tiktok', id: 't1', caption: 'ok', publishedAt: '2026-08-06T00:00:00Z', viewCount: 100, likeCount: 5, commentCount: 1, permalink: 'https://tiktok.com/@creator/video/t1' },
    ]);
    const youtubeClient = createFakeYouTubeClient();
    vi.spyOn(youtubeClient, 'getChannelUploads').mockRejectedValue(new Error('boom'));
    const deps = makeDeps({
      youtubeClient,
      scraperClient,
      getProfileHandles: async () => ({ youtube: 'creator', tiktok: 'creator', instagram: null }),
    });

    const result = await handleRecapRequest(deps, { profileId: 'p1', ip: '203.0.113.1', now: NOW });
    expect(result.status).toBe(200);
    const body = result.body as { recapCard: RecapCardRow };
    expect(body.recapCard.warnings).toEqual(['youtube_scrape_failed']);
    expect(body.recapCard.totals.postCount).toBe(1);
  });

  it('returns a distinct 422 without saving a card when every connected platform is empty this month', async () => {
    const deps = makeDeps({
      scraperClient: createFakeScraperClient({}, []),
      youtubeClient: createFakeYouTubeClient({}, []),
    });
    const saveRecapCardSpy = vi.spyOn(deps, 'saveRecapCard');

    const result = await handleRecapRequest(deps, { profileId: 'p1', ip: '203.0.113.1', now: NOW });
    expect(result.status).toBe(422);
    expect(saveRecapCardSpy).not.toHaveBeenCalled();
  });

  it('rate-limits repeated generation attempts per profile per day', async () => {
    const deps = makeDeps({ scraperClient: createFakeScraperClient({}, []), youtubeClient: createFakeYouTubeClient({}, []) });
    let result;
    for (let i = 0; i < RECAP_GENERATION_PROFILE_LIMIT; i++) {
      result = await handleRecapRequest(deps, { profileId: 'p1', ip: '203.0.113.1', now: NOW });
      expect(result.status).toBe(422); // nothing published, but still consumes an attempt
    }
    result = await handleRecapRequest(deps, { profileId: 'p1', ip: '203.0.113.1', now: NOW });
    expect(result.status).toBe(429);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/recap/handler.test.ts`
Expected: FAIL with `Cannot find module '@/lib/recap/handler'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/recap/handler.ts
import { checkAndRecordRateLimit, releaseRateLimitEventIfNeeded, hashIp, type RateLimitStore } from '@/lib/rate-limit';
import type { YouTubeClient } from '@/lib/integrations/youtube';
import type { ScraperClient } from '@/lib/integrations/scraper';
import { filterPostsToMonth, aggregateRecap } from './aggregate';
import type { AggregatablePost, PlatformTotals, RecapCardRow, RecapHandles, RecapPlatform, RecapTopPost } from './types';

export const RECAP_GENERATION_PROFILE_LIMIT = 5;
export const RECAP_GENERATION_IP_LIMIT = 10;

export interface RecapHandlerDeps {
  rateLimitStore: RateLimitStore;
  youtubeClient: YouTubeClient;
  scraperClient: ScraperClient;
  ipSalt: string;
  getProfileHandles: (profileId: string) => Promise<RecapHandles>;
  getExistingRecapCard: (profileId: string, month: string) => Promise<RecapCardRow | null>;
  saveRecapCard: (params: {
    profileId: string;
    month: string;
    platformData: Partial<Record<RecapPlatform, PlatformTotals>>;
    totals: PlatformTotals;
    topPost: RecapTopPost;
    warnings: string[];
  }) => Promise<RecapCardRow>;
}

export interface RecapRequestContext {
  profileId: string | null;
  ip: string;
  now: Date;
}

export interface RecapHandlerResult {
  status: number;
  body: Record<string, unknown>;
}

function monthKey(date: Date): { label: string; year: number; month: number } {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  return { label: `${year}-${String(month).padStart(2, '0')}-01`, year, month };
}

export async function handleRecapRequest(deps: RecapHandlerDeps, context: RecapRequestContext): Promise<RecapHandlerResult> {
  if (!context.profileId) {
    return { status: 401, body: { error: 'You must be signed in to generate a recap card.' } };
  }

  const handles = await deps.getProfileHandles(context.profileId);
  const connected = (['youtube', 'tiktok', 'instagram'] as const).filter((p) => handles[p]);
  if (connected.length === 0) {
    return { status: 400, body: { error: 'Connect at least one platform before generating a recap.' } };
  }

  const { label: month, year, month: monthNum } = monthKey(context.now);

  const existing = await deps.getExistingRecapCard(context.profileId, month);
  if (existing) {
    return { status: 200, body: { recapCard: existing } };
  }

  const ipHash = hashIp(context.ip, deps.ipSalt);
  const rateLimitResult = await checkAndRecordRateLimit({
    store: deps.rateLimitStore,
    profileId: context.profileId,
    ipHash,
    eventType: 'recap_generation',
    profileLimit: RECAP_GENERATION_PROFILE_LIMIT,
    ipLimit: RECAP_GENERATION_IP_LIMIT,
    windowDays: 1,
    now: context.now,
  });

  if (!rateLimitResult.allowed) {
    return {
      status: 429,
      body: {
        error:
          rateLimitResult.reason === 'ip_limit'
            ? 'Too many recap generations have been requested from this network recently. Please try again later.'
            : "You've hit today's limit for recap generation attempts. Please try again tomorrow.",
        retryAfter: rateLimitResult.retryAfter?.toISOString(),
      },
    };
  }

  try {
    const warnings: string[] = [];
    const postsByPlatform: Partial<Record<RecapPlatform, AggregatablePost[]>> = {};

    if (handles.youtube) {
      try {
        const videos = await deps.youtubeClient.getChannelUploads(handles.youtube);
        postsByPlatform.youtube = filterPostsToMonth(
          videos.map((v) => ({
            platform: 'youtube' as const,
            captionOrTitle: v.title,
            publishedAt: v.publishedAt,
            viewCount: v.viewCount,
            likeCount: v.likeCount,
            commentCount: v.commentCount,
            permalink: `https://youtube.com/watch?v=${v.id}`,
          })),
          { year, month: monthNum }
        );
      } catch (err) {
        console.error('YouTube recap fetch failed:', err);
        warnings.push('youtube_scrape_failed');
      }
    }

    for (const platform of ['tiktok', 'instagram'] as const) {
      const handle = handles[platform];
      if (!handle) continue;
      try {
        const posts = await deps.scraperClient.fetchProfilePosts(platform, handle);
        postsByPlatform[platform] = filterPostsToMonth(
          posts.map((p) => ({
            platform,
            captionOrTitle: p.caption,
            publishedAt: p.publishedAt,
            viewCount: p.viewCount,
            likeCount: p.likeCount,
            commentCount: p.commentCount,
            permalink: p.permalink,
          })),
          { year, month: monthNum }
        );
      } catch (err) {
        console.error(`${platform} recap fetch failed:`, err);
        warnings.push(`${platform}_scrape_failed`);
      }
    }

    const aggregation = aggregateRecap(postsByPlatform);
    if (!aggregation.topPost || aggregation.totals.postCount === 0) {
      // A real, costly scrape ran and genuinely found nothing this
      // month — not our own failure, so the rate-limit event is NOT
      // released; it's a legitimate use of one of today's attempts. No
      // row is written, so a later attempt this month isn't blocked by
      // the (profile, month) unique constraint. See spec §2 step 5.
      return {
        status: 422,
        body: { error: "Looks like nothing was published on your connected platforms this month yet.", warnings },
      };
    }

    const saved = await deps.saveRecapCard({
      profileId: context.profileId,
      month,
      platformData: aggregation.platformData,
      totals: aggregation.totals,
      topPost: aggregation.topPost,
      warnings,
    });

    return { status: 200, body: { recapCard: saved } };
  } catch (err) {
    await releaseRateLimitEventIfNeeded({ store: deps.rateLimitStore, eventId: rateLimitResult.eventId });
    throw err;
  }
}
```

```ts
// app/api/recap/route.ts
import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { createSupabaseRateLimitStore } from '@/lib/supabase/rate-limit-store';
import { createYouTubeClient } from '@/lib/integrations/youtube';
import { createApifyScraperClient } from '@/lib/integrations/scraper';
import { deriveClientIp } from '@/lib/ip';
import { handleRecapRequest } from '@/lib/recap/handler';
import type { RecapCardRow } from '@/lib/recap/types';

function currentMonthKey(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function mapRecapCardRow(row: {
  id: string;
  profile_id: string;
  month: string;
  platform_data: unknown;
  totals: unknown;
  top_post: unknown;
  warnings: string[];
  generated_at: string;
}): RecapCardRow {
  return {
    id: row.id,
    profileId: row.profile_id,
    month: row.month,
    platformData: row.platform_data as RecapCardRow['platformData'],
    totals: row.totals as RecapCardRow['totals'],
    topPost: row.top_post as RecapCardRow['topPost'],
    warnings: row.warnings,
    generatedAt: row.generated_at,
  };
}

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'You must be signed in to view your recap settings.' }, { status: 401 });
  }

  const serviceClient = createSupabaseServiceRoleClient();
  const { data: profile } = await serviceClient
    .from('profiles')
    .select('youtube_channel_handle,tiktok_handle,instagram_handle')
    .eq('id', user.id)
    .single();

  const { data: existingCard } = await serviceClient
    .from('recap_cards')
    .select('id')
    .eq('profile_id', user.id)
    .eq('month', currentMonthKey(new Date()))
    .maybeSingle();

  return NextResponse.json({
    handles: {
      youtube: profile?.youtube_channel_handle ?? null,
      tiktok: profile?.tiktok_handle ?? null,
      instagram: profile?.instagram_handle ?? null,
    },
    recapCardId: existingCard?.id ?? null,
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

    const result = await handleRecapRequest(
      {
        rateLimitStore: createSupabaseRateLimitStore(serviceClient),
        youtubeClient: createYouTubeClient(process.env.YOUTUBE_API_KEY ?? ''),
        scraperClient: createApifyScraperClient(process.env.APIFY_API_TOKEN ?? ''),
        ipSalt: process.env.RATE_LIMIT_IP_SALT ?? 'dev-salt',
        getProfileHandles: async (profileId) => {
          const { data } = await serviceClient
            .from('profiles')
            .select('youtube_channel_handle,tiktok_handle,instagram_handle')
            .eq('id', profileId)
            .single();
          return {
            youtube: data?.youtube_channel_handle ?? null,
            tiktok: data?.tiktok_handle ?? null,
            instagram: data?.instagram_handle ?? null,
          };
        },
        getExistingRecapCard: async (profileId, month) => {
          const { data } = await serviceClient
            .from('recap_cards')
            .select('*')
            .eq('profile_id', profileId)
            .eq('month', month)
            .maybeSingle();
          return data ? mapRecapCardRow(data) : null;
        },
        saveRecapCard: async ({ profileId, month, platformData, totals, topPost, warnings }) => {
          const { data, error } = await serviceClient
            .from('recap_cards')
            .insert({ profile_id: profileId, month, platform_data: platformData, totals, top_post: topPost, warnings })
            .select('*')
            .single();
          if (error || !data) {
            throw new Error(`Failed to save recap card: ${error?.message}`);
          }
          return mapRecapCardRow(data);
        },
      },
      { profileId: user?.id ?? null, ip, now: new Date() }
    );

    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    console.error('Recap generation failed:', err);
    return NextResponse.json({ error: 'Something went wrong generating your recap card. Please try again.' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/recap/handler.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/recap/handler.ts app/api/recap/route.ts tests/unit/lib/recap/handler.test.ts
git commit -m "feat: add recap generation handler and GET/POST /api/recap route"
```

---

### Task 7: Public JSON route for a recap card

**Files:**
- Create: `app/api/recap/[id]/route.ts`

**Interfaces:**
- Consumes: `RecapCardRow` from `@/lib/recap/types` (Task 4); `createSupabaseServiceRoleClient` from `@/lib/supabase/server` (existing)
- Produces: `GET /api/recap/[id]` — relied on by Task 11 (`app/recap/[id]/page.tsx`)

This route (like `app/api/diagnostic/[id]/route.ts`) is a thin, effectively untested wrapper — matches existing repo precedent of not unit-testing single-query passthrough routes. Covered end-to-end by Task 12's Playwright test.

- [ ] **Step 1: Write the implementation**

```ts
// app/api/recap/[id]/route.ts
import { NextResponse } from 'next/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import type { RecapCardRow } from '@/lib/recap/types';

function mapRecapCardRow(row: {
  id: string;
  profile_id: string;
  month: string;
  platform_data: unknown;
  totals: unknown;
  top_post: unknown;
  warnings: string[];
  generated_at: string;
}): RecapCardRow {
  return {
    id: row.id,
    profileId: row.profile_id,
    month: row.month,
    platformData: row.platform_data as RecapCardRow['platformData'],
    totals: row.totals as RecapCardRow['totals'],
    topPost: row.top_post as RecapCardRow['topPost'],
    warnings: row.warnings,
    generatedAt: row.generated_at,
  };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Public by design: recap_cards' RLS policy restricts reads to the
  // owner, but this route is the shareable card's data source — a link a
  // creator hands to their own audience, so it deliberately bypasses that
  // policy via the service-role client, the same reasoning as
  // app/recap/[id]/image/route.tsx below. The stats stored here aren't
  // sensitive; that's what makes this an acceptable public surface.
  const supabase = createSupabaseServiceRoleClient();
  const { data, error } = await supabase.from('recap_cards').select('*').eq('id', id).single();

  if (error || !data) {
    return NextResponse.json({ error: 'Recap card not found.' }, { status: 404 });
  }

  return NextResponse.json({ recapCard: mapRecapCardRow(data) });
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/recap/[id]/route.ts
git commit -m "feat: add public GET /api/recap/[id] route"
```

---

### Task 8: Public image route (`ImageResponse`)

**Files:**
- Create: `app/recap/[id]/image/route.tsx`

**Interfaces:**
- Consumes: `createSupabaseServiceRoleClient` from `@/lib/supabase/server` (existing); `ImageResponse` from `next/og`
- Produces: `GET /recap/[id]/image` — the stable, embeddable PNG URL; relied on by Task 11 (`app/recap/[id]/page.tsx`) and Task 12's E2E test

Per the spec's testing note, `ImageResponse` output is presentational and not unit-tested beyond compiling — this is this plan's other documented TDD exception (alongside Task 7), verified manually instead. Covered visually by Task 12's Playwright test (which mocks this route's response rather than rendering a real PNG, keeping the E2E suite fast and deterministic).

- [ ] **Step 1: Write the implementation**

```tsx
// app/recap/[id]/image/route.tsx
import { ImageResponse } from 'next/og';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const PLATFORM_LABELS: Record<string, string> = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram' };

function formatCompactNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Public by design — see the identical comment in
  // app/api/recap/[id]/route.ts. This is the URL a creator posts directly
  // to their own social feed; it must render for anonymous viewers.
  const supabase = createSupabaseServiceRoleClient();
  const { data, error } = await supabase.from('recap_cards').select('*').eq('id', id).single();

  if (error || !data) {
    return new Response('Recap card not found', { status: 404 });
  }

  const monthLabel = new Date(data.month).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const totals = data.totals as { views: number; likes: number; postCount: number };
  const topPost = data.top_post as { platform: string; captionOrTitle: string; viewCount: number };
  const platformData = data.platform_data as Record<string, { views: number }>;

  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          backgroundColor: '#4338ca',
          padding: '64px',
          color: 'white',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 28, opacity: 0.8 }}>{monthLabel} Recap</div>
          <div style={{ fontSize: 96, fontWeight: 700, marginTop: 12 }}>{formatCompactNumber(totals.views)} views</div>
          <div style={{ fontSize: 28, marginTop: 8, opacity: 0.9 }}>
            {formatCompactNumber(totals.postCount)} posts · {formatCompactNumber(totals.likes)} likes
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 22, opacity: 0.8 }}>Top post</div>
          <div style={{ fontSize: 30, fontWeight: 600 }}>
            {PLATFORM_LABELS[topPost.platform] ?? topPost.platform} · {formatCompactNumber(topPost.viewCount)} views
          </div>
          <div style={{ fontSize: 22, opacity: 0.85, maxWidth: 900 }}>{topPost.captionOrTitle.slice(0, 90)}</div>
        </div>
        <div style={{ display: 'flex', gap: 24 }}>
          {Object.entries(platformData).map(([platform, stats]) => (
            <div key={platform} style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: 18, opacity: 0.75 }}>{PLATFORM_LABELS[platform] ?? platform}</div>
              <div style={{ fontSize: 26, fontWeight: 600 }}>{formatCompactNumber(stats.views)}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 20, opacity: 0.6 }}>Creator Dashboard</div>
      </div>
    ),
    { width: 1080, height: 1350 }
  );
}
```

- [ ] **Step 2: Manually verify**

Run: `npm run build`
Expected: builds cleanly with no type errors on the new route (confirms the JSX/`ImageResponse` usage compiles under this repo's TypeScript config).

If Supabase env vars are configured locally, also run `npm run dev`, generate a card through `/recap`, then `curl -o /tmp/card.png http://localhost:3000/recap/<id>/image` and open the file to confirm it renders as expected — otherwise, defer this visual check to Task 12's E2E run.

- [ ] **Step 3: Commit**

```bash
git add app/recap/[id]/image/route.tsx
git commit -m "feat: add public ImageResponse route for the recap card PNG"
```

---

### Task 9: `/recap` page state machine

**Files:**
- Create: `lib/recap/page-state.ts`
- Test: `tests/unit/lib/recap/page-state.test.ts`

**Interfaces:**
- Consumes: `RecapPlatform` from `@/lib/recap/types` (Task 4)
- Produces: `RecapHandleInputs`, `EMPTY_HANDLE_INPUTS`, `RecapPageState`, `RecapPageEvent`, `createInitialRecapPageState()`, `recapPageReducer(state, event)` — relied on by Task 10 (`app/recap/page.tsx`)

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lib/recap/page-state.test.ts
import { describe, it, expect } from 'vitest';
import {
  recapPageReducer,
  createInitialRecapPageState,
  EMPTY_HANDLE_INPUTS,
  type RecapPageState,
} from '@/lib/recap/page-state';

describe('createInitialRecapPageState', () => {
  it('starts in loading', () => {
    expect(createInitialRecapPageState()).toEqual({ status: 'loading' });
  });
});

describe('recapPageReducer — bootstrap', () => {
  it('moves to noHandlesConnected when no handles come back', () => {
    const next = recapPageReducer(
      { status: 'loading' },
      { type: 'BOOTSTRAPPED', handles: EMPTY_HANDLE_INPUTS, recapCardId: null }
    );
    expect(next).toEqual({ status: 'noHandlesConnected', handles: EMPTY_HANDLE_INPUTS, error: null });
  });

  it('moves to readyToGenerate when at least one handle is already connected', () => {
    const handles = { youtube: 'creator', tiktok: '', instagram: '' };
    const next = recapPageReducer({ status: 'loading' }, { type: 'BOOTSTRAPPED', handles, recapCardId: null });
    expect(next).toEqual({ status: 'readyToGenerate', handles });
  });

  it('moves straight to redirectingToCard when this month already has a card', () => {
    const next = recapPageReducer(
      { status: 'loading' },
      { type: 'BOOTSTRAPPED', handles: { youtube: 'creator', tiktok: '', instagram: '' }, recapCardId: 'card-1' }
    );
    expect(next).toEqual({ status: 'redirectingToCard', recapCardId: 'card-1' });
  });

  it('moves to noHandlesConnected with an error on BOOTSTRAP_FAILED', () => {
    const next = recapPageReducer({ status: 'loading' }, { type: 'BOOTSTRAP_FAILED' });
    expect(next).toEqual({
      status: 'noHandlesConnected',
      handles: EMPTY_HANDLE_INPUTS,
      error: "We couldn't load your recap settings. Please refresh and try again.",
    });
  });
});

describe('recapPageReducer — handle editing', () => {
  it('updates one platform field from noHandlesConnected', () => {
    const state: RecapPageState = { status: 'noHandlesConnected', handles: EMPTY_HANDLE_INPUTS, error: null };
    const next = recapPageReducer(state, { type: 'HANDLE_CHANGED', platform: 'tiktok', value: 'creator' });
    expect(next).toEqual({ status: 'noHandlesConnected', handles: { ...EMPTY_HANDLE_INPUTS, tiktok: 'creator' }, error: null });
  });

  it('ignores HANDLE_CHANGED while generating (impossible-state guard)', () => {
    const state: RecapPageState = { status: 'generating', handles: EMPTY_HANDLE_INPUTS, stillWorking: false };
    expect(recapPageReducer(state, { type: 'HANDLE_CHANGED', platform: 'tiktok', value: 'x' })).toBe(state);
  });

  it('moves noHandlesConnected to readyToGenerate on HANDLES_SAVED', () => {
    const handles = { youtube: 'creator', tiktok: '', instagram: '' };
    const state: RecapPageState = { status: 'noHandlesConnected', handles, error: null };
    expect(recapPageReducer(state, { type: 'HANDLES_SAVED' })).toEqual({ status: 'readyToGenerate', handles });
  });

  it('preserves the handles and sets an error on HANDLES_SAVE_FAILED', () => {
    const handles = { youtube: 'not valid!', tiktok: '', instagram: '' };
    const state: RecapPageState = { status: 'noHandlesConnected', handles, error: null };
    const next = recapPageReducer(state, { type: 'HANDLES_SAVE_FAILED', error: 'boom' });
    expect(next).toEqual({ status: 'noHandlesConnected', handles, error: 'boom' });
  });
});

describe('recapPageReducer — generation', () => {
  const handles = { youtube: 'creator', tiktok: '', instagram: '' };

  it('moves readyToGenerate to generating on GENERATE', () => {
    const next = recapPageReducer({ status: 'readyToGenerate', handles }, { type: 'GENERATE' });
    expect(next).toEqual({ status: 'generating', handles, stillWorking: false });
  });

  it('also allows GENERATE to retry from generationFailed', () => {
    const state: RecapPageState = { status: 'generationFailed', handles, error: 'boom' };
    expect(recapPageReducer(state, { type: 'GENERATE' })).toEqual({ status: 'generating', handles, stillWorking: false });
  });

  it('sets stillWorking on GENERATE_STILL_WORKING without changing status', () => {
    const state: RecapPageState = { status: 'generating', handles, stillWorking: false };
    expect(recapPageReducer(state, { type: 'GENERATE_STILL_WORKING' })).toEqual({ status: 'generating', handles, stillWorking: true });
  });

  it('moves to redirectingToCard on GENERATE_SUCCESS', () => {
    const state: RecapPageState = { status: 'generating', handles, stillWorking: true };
    expect(recapPageReducer(state, { type: 'GENERATE_SUCCESS', recapCardId: 'card-2' })).toEqual({
      status: 'redirectingToCard',
      recapCardId: 'card-2',
    });
  });

  it('moves to generationFailed preserving the handles on GENERATE_FAILED', () => {
    const state: RecapPageState = { status: 'generating', handles, stillWorking: false };
    expect(recapPageReducer(state, { type: 'GENERATE_FAILED', error: 'boom' })).toEqual({
      status: 'generationFailed',
      handles,
      error: 'boom',
    });
  });

  it('ignores GENERATE from noHandlesConnected (impossible-state guard)', () => {
    const state: RecapPageState = { status: 'noHandlesConnected', handles: EMPTY_HANDLE_INPUTS, error: null };
    expect(recapPageReducer(state, { type: 'GENERATE' })).toBe(state);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/recap/page-state.test.ts`
Expected: FAIL with `Cannot find module '@/lib/recap/page-state'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/recap/page-state.ts
import type { RecapPlatform } from './types';

export type RecapHandleInputs = Record<RecapPlatform, string>;

export const EMPTY_HANDLE_INPUTS: RecapHandleInputs = { youtube: '', tiktok: '', instagram: '' };

export type RecapPageState =
  | { status: 'loading' }
  | { status: 'noHandlesConnected'; handles: RecapHandleInputs; error: string | null }
  | { status: 'readyToGenerate'; handles: RecapHandleInputs }
  | { status: 'generating'; handles: RecapHandleInputs; stillWorking: boolean }
  | { status: 'redirectingToCard'; recapCardId: string }
  | { status: 'generationFailed'; handles: RecapHandleInputs; error: string };

export type RecapPageEvent =
  | { type: 'BOOTSTRAPPED'; handles: RecapHandleInputs; recapCardId: string | null }
  | { type: 'BOOTSTRAP_FAILED' }
  | { type: 'HANDLE_CHANGED'; platform: RecapPlatform; value: string }
  | { type: 'HANDLES_SAVED' }
  | { type: 'HANDLES_SAVE_FAILED'; error: string }
  | { type: 'GENERATE' }
  | { type: 'GENERATE_STILL_WORKING' }
  | { type: 'GENERATE_SUCCESS'; recapCardId: string }
  | { type: 'GENERATE_FAILED'; error: string };

function hasAnyHandle(handles: RecapHandleInputs): boolean {
  return Boolean(handles.youtube || handles.tiktok || handles.instagram);
}

export function createInitialRecapPageState(): RecapPageState {
  return { status: 'loading' };
}

export function recapPageReducer(state: RecapPageState, event: RecapPageEvent): RecapPageState {
  switch (event.type) {
    case 'BOOTSTRAPPED':
      if (event.recapCardId) {
        return { status: 'redirectingToCard', recapCardId: event.recapCardId };
      }
      return hasAnyHandle(event.handles)
        ? { status: 'readyToGenerate', handles: event.handles }
        : { status: 'noHandlesConnected', handles: event.handles, error: null };

    case 'BOOTSTRAP_FAILED':
      return {
        status: 'noHandlesConnected',
        handles: EMPTY_HANDLE_INPUTS,
        error: "We couldn't load your recap settings. Please refresh and try again.",
      };

    case 'HANDLE_CHANGED':
      return state.status === 'noHandlesConnected' || state.status === 'readyToGenerate'
        ? { ...state, handles: { ...state.handles, [event.platform]: event.value } }
        : state;

    case 'HANDLES_SAVED':
      return state.status === 'noHandlesConnected' || state.status === 'readyToGenerate'
        ? { status: 'readyToGenerate', handles: state.handles }
        : state;

    case 'HANDLES_SAVE_FAILED':
      return state.status === 'noHandlesConnected' || state.status === 'readyToGenerate'
        ? { status: 'noHandlesConnected', handles: state.handles, error: event.error }
        : state;

    case 'GENERATE':
      return state.status === 'readyToGenerate' || state.status === 'generationFailed'
        ? { status: 'generating', handles: state.handles, stillWorking: false }
        : state;

    case 'GENERATE_STILL_WORKING':
      return state.status === 'generating' ? { ...state, stillWorking: true } : state;

    case 'GENERATE_SUCCESS':
      return state.status === 'generating' ? { status: 'redirectingToCard', recapCardId: event.recapCardId } : state;

    case 'GENERATE_FAILED':
      return state.status === 'generating' ? { status: 'generationFailed', handles: state.handles, error: event.error } : state;

    default:
      return state;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/recap/page-state.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/recap/page-state.ts tests/unit/lib/recap/page-state.test.ts
git commit -m "feat: add recap page state machine"
```

---

### Task 10: `/recap` management page + landing page link

**Files:**
- Create: `app/recap/page.tsx`
- Test: `tests/unit/app/recap/page.test.tsx`
- Modify: `app/page.tsx`
- Modify: `tests/unit/app/page.test.tsx`

**Interfaces:**
- Consumes: `recapPageReducer`, `createInitialRecapPageState` from `@/lib/recap/page-state` (Task 9); `<Spinner>` from `@/components/Spinner` (existing, from the sign-in-flow plan); `GET`/`POST /api/recap` (Task 6), `POST /api/recap/handles` (Task 5) response shapes
- Produces: `RecapPage` default export — exercised end-to-end by Task 12's Playwright test

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/app/recap/page.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

import RecapPage from '@/app/recap/page';

describe('RecapPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    pushMock.mockClear();
  });

  it('shows the handle form when no platforms are connected yet', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ handles: { youtube: null, tiktok: null, instagram: null }, recapCardId: null }),
      })
    );
    render(<RecapPage />);
    await waitFor(() => expect(screen.getByLabelText(/youtube channel handle/i)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /generate this month/i })).not.toBeInTheDocument();
  });

  it('redirects straight to the card page when this month already has one', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ handles: { youtube: 'creator', tiktok: null, instagram: null }, recapCardId: 'card-1' }),
      })
    );
    render(<RecapPage />);
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/recap/card-1'));
  });

  it('shows the generate button once a platform is connected, and generating redirects to the new card', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ handles: { youtube: 'creator', tiktok: null, instagram: null }, recapCardId: null }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ recapCard: { id: 'card-2' } }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<RecapPage />);
    await waitFor(() => screen.getByRole('button', { name: /generate this month/i }));
    fireEvent.click(screen.getByRole('button', { name: /generate this month/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/recap/card-2'));
    expect(fetchMock).toHaveBeenLastCalledWith('/api/recap', { method: 'POST' });
  });

  it('shows an error and a retry button when generation fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ handles: { youtube: 'creator', tiktok: null, instagram: null }, recapCardId: null }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Looks like nothing was published on your connected platforms this month yet.' }),
      });
    vi.stubGlobal('fetch', fetchMock);

    render(<RecapPage />);
    await waitFor(() => screen.getByRole('button', { name: /generate this month/i }));
    fireEvent.click(screen.getByRole('button', { name: /generate this month/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('nothing was published'));
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('saves handles and shows the generate button on success', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ handles: { youtube: null, tiktok: null, instagram: null }, recapCardId: null }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<RecapPage />);
    await waitFor(() => screen.getByLabelText(/youtube channel handle/i));
    fireEvent.change(screen.getByLabelText(/youtube channel handle/i), { target: { value: 'creator' } });
    fireEvent.click(screen.getByRole('button', { name: /save platforms/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: /generate this month/i })).toBeInTheDocument());
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/recap/handles',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ youtube: 'creator', tiktok: '', instagram: '' }),
      })
    );
  });
});
```

Append this assertion inside the existing `describe` block in `tests/unit/app/page.test.tsx` (matching whatever structure that file already uses to render `HomePage` and query links):

```ts
  it('links to the recap page', () => {
    render(<HomePage />);
    expect(screen.getByRole('link', { name: /recap card/i })).toHaveAttribute('href', '/recap');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/app/recap/page.test.tsx tests/unit/app/page.test.tsx`
Expected: FAIL — `Cannot find module '@/app/recap/page'`, and the new landing-page link assertion fails against today's markup.

- [ ] **Step 3: Write minimal implementation**

```tsx
// app/recap/page.tsx
'use client';

import { useEffect, useReducer, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Spinner } from '@/components/Spinner';
import { recapPageReducer, createInitialRecapPageState, type RecapPlatform } from '@/lib/recap/page-state';

const PLATFORM_LABELS: Record<RecapPlatform, string> = {
  youtube: 'YouTube channel handle',
  tiktok: 'TikTok handle',
  instagram: 'Instagram handle',
};

export default function RecapPage() {
  const router = useRouter();
  const [state, dispatch] = useReducer(recapPageReducer, createInitialRecapPageState());
  const stillWorkingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/recap')
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          dispatch({ type: 'BOOTSTRAP_FAILED' });
          return;
        }
        dispatch({ type: 'BOOTSTRAPPED', handles: data.handles, recapCardId: data.recapCardId });
      })
      .catch(() => {
        if (!cancelled) dispatch({ type: 'BOOTSTRAP_FAILED' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (state.status === 'redirectingToCard') {
      router.push(`/recap/${state.recapCardId}`);
    }
  }, [state, router]);

  useEffect(() => {
    if (state.status !== 'generating') return undefined;
    stillWorkingTimer.current = setTimeout(() => dispatch({ type: 'GENERATE_STILL_WORKING' }), 8000);
    return () => {
      if (stillWorkingTimer.current) clearTimeout(stillWorkingTimer.current);
    };
  }, [state.status]);

  async function saveHandles() {
    if (state.status !== 'noHandlesConnected' && state.status !== 'readyToGenerate') return;
    const res = await fetch('/api/recap/handles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.handles),
    });
    const data = await res.json();
    if (!res.ok) {
      dispatch({ type: 'HANDLES_SAVE_FAILED', error: data.error ?? 'Something went wrong saving your handles.' });
      return;
    }
    dispatch({ type: 'HANDLES_SAVED' });
  }

  async function generate() {
    dispatch({ type: 'GENERATE' });
    try {
      const res = await fetch('/api/recap', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        dispatch({ type: 'GENERATE_FAILED', error: data.error ?? 'Something went wrong generating your recap card.' });
        return;
      }
      dispatch({ type: 'GENERATE_SUCCESS', recapCardId: data.recapCard.id });
    } catch {
      dispatch({ type: 'GENERATE_FAILED', error: "We couldn't reach the server. Check your connection and try again." });
    }
  }

  if (state.status === 'loading' || state.status === 'redirectingToCard') {
    return <p>Loading…</p>;
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-6 py-16">
      <h1 className="text-2xl font-bold text-gray-900">Monthly recap card</h1>
      <p className="text-gray-600">Connect your platforms once, then generate a shareable card of this month&apos;s stats.</p>

      <div className="flex flex-col gap-3">
        {(['youtube', 'tiktok', 'instagram'] as const).map((platform) => (
          <label key={platform} className="flex flex-col gap-1 text-sm font-medium text-gray-700">
            {PLATFORM_LABELS[platform]}
            <input
              type="text"
              value={state.handles[platform]}
              onChange={(e) => dispatch({ type: 'HANDLE_CHANGED', platform, value: e.target.value })}
              placeholder="@handle or profile URL"
              className="rounded-lg border border-gray-300 px-4 py-2 font-normal"
            />
          </label>
        ))}
        <button
          type="button"
          onClick={saveHandles}
          className="self-start rounded-full border border-indigo-600 px-4 py-2 text-sm font-semibold text-indigo-700"
        >
          Save platforms
        </button>
      </div>

      {state.status === 'noHandlesConnected' && state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}

      {state.status === 'readyToGenerate' && (
        <button
          type="button"
          onClick={generate}
          className="rounded-full bg-indigo-600 px-6 py-3 font-semibold text-white hover:bg-indigo-700"
        >
          Generate this month&apos;s recap
        </button>
      )}

      {state.status === 'generating' && (
        <Spinner label={state.stillWorking ? 'Still working — pulling your posts from each platform…' : 'Generating…'} />
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
    </main>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/app/recap/page.test.tsx tests/unit/app/page.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/recap/page.tsx tests/unit/app/recap/page.test.tsx app/page.tsx tests/unit/app/page.test.tsx
git commit -m "feat: add /recap management page and landing page link"
```

---

### Task 11: `/recap/[id]` public share page

**Files:**
- Create: `app/recap/[id]/page.tsx`
- Test: `tests/unit/app/recap/id-page.test.tsx`

**Interfaces:**
- Consumes: `GET /api/recap/[id]` (Task 7); `GET /recap/[id]/image` (Task 8, referenced by URL only, not imported)
- Produces: `RecapCardPage` default export — the terminal integration point a creator shares off-platform; exercised end-to-end by Task 12's Playwright test

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/app/recap/id-page.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'recap-1' }),
}));

import RecapCardPage from '@/app/recap/[id]/page';

describe('RecapCardPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the month heading, the card image, and a download link', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({
          recapCard: {
            month: '2026-08-01',
            totals: { views: 127000, likes: 8200, comments: 430, postCount: 14 },
            topPost: { platform: 'tiktok', captionOrTitle: 'Wait for it...', viewCount: 52000, permalink: 'https://tiktok.com/@creator/video/1' },
          },
        }),
      })
    );

    render(<RecapCardPage />);

    expect(screen.getByText(/loading your recap card/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('heading', { name: /august 2026 recap/i })).toBeInTheDocument());
    expect(screen.getByRole('img')).toHaveAttribute('src', '/recap/recap-1/image');
    expect(screen.getByRole('link', { name: /download image/i })).toHaveAttribute('href', '/recap/recap-1/image');
  });

  it('shows an error message when the recap card is not found', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ error: 'Recap card not found.' }) }));
    render(<RecapCardPage />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Recap card not found.'));
  });

  it('shows an error message when the network request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
    render(<RecapCardPage />);
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong loading this recap card. Please try again.')
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/app/recap/id-page.test.tsx`
Expected: FAIL with `Cannot find module '@/app/recap/[id]/page'`

- [ ] **Step 3: Write minimal implementation**

```tsx
// app/recap/[id]/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

interface RecapCardData {
  month: string;
  totals: { views: number; likes: number; comments: number; postCount: number };
  topPost: { platform: string; captionOrTitle: string; viewCount: number; permalink: string };
}

export default function RecapCardPage() {
  const params = useParams<{ id: string }>();
  const [card, setCard] = useState<RecapCardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/recap/${params.id}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setError(data.error);
          return;
        }
        setCard(data.recapCard);
      })
      .catch(() => {
        if (!cancelled) setError('Something went wrong loading this recap card. Please try again.');
      });
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  if (error) {
    return <p role="alert">{error}</p>;
  }

  if (!card) {
    return <p>Loading your recap card…</p>;
  }

  const monthLabel = new Date(card.month).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return (
    <main className="mx-auto flex max-w-md flex-col items-center gap-6 px-6 py-16 text-center">
      <h1 className="text-2xl font-bold text-gray-900">{monthLabel} Recap</h1>
      <img
        src={`/recap/${params.id}/image`}
        alt={`${monthLabel} recap card: ${card.totals.views} total views`}
        className="w-full rounded-lg shadow-lg"
      />
      <a
        href={`/recap/${params.id}/image`}
        download
        className="rounded-full bg-indigo-600 px-6 py-3 font-semibold text-white hover:bg-indigo-700"
      >
        Download image
      </a>
    </main>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/app/recap/id-page.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/recap/[id]/page.tsx tests/unit/app/recap/id-page.test.tsx
git commit -m "feat: add public /recap/[id] share page"
```

---

### Task 12: Playwright E2E smoke test

**Files:**
- Create: `tests/e2e/recap-smoke.spec.ts`

**Interfaces:**
- Consumes: `/recap` (Task 10), `/recap/[id]` (Task 11), and the `/api/recap*` + `/recap/[id]/image` routes (Tasks 5–8), all via mocked network responses
- Produces: nothing further downstream — terminal verification for this plan

- [ ] **Step 1: Write the test**

```ts
// tests/e2e/recap-smoke.spec.ts
import { test, expect } from '@playwright/test';

test('connecting a platform and generating a recap redirects to a shareable card', async ({ page }) => {
  await page.route('**/api/recap', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ handles: { youtube: null, tiktok: null, instagram: null }, recapCardId: null }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ recapCard: { id: 'e2e-recap-1' } }),
    });
  });

  await page.route('**/api/recap/handles', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  await page.route('**/api/recap/e2e-recap-1', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        recapCard: {
          id: 'e2e-recap-1',
          month: '2026-08-01',
          totals: { views: 127000, likes: 8200, comments: 430, postCount: 14 },
          topPost: {
            platform: 'tiktok',
            captionOrTitle: 'Wait for it...',
            viewCount: 52000,
            permalink: 'https://tiktok.com/@creator/video/1',
          },
        },
      }),
    });
  });

  await page.route('**/recap/e2e-recap-1/image', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      // 1x1 transparent PNG — content doesn't matter for this smoke test,
      // only that the page requests and displays an image at this URL.
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64'
      ),
    });
  });

  await page.goto('/recap');
  await page.getByLabel(/youtube channel handle/i).fill('creator');
  await page.getByRole('button', { name: /save platforms/i }).click();
  await page.getByRole('button', { name: /generate this month/i }).click();

  await expect(page).toHaveURL(/\/recap\/e2e-recap-1$/);
  await expect(page.getByRole('heading', { name: /august 2026 recap/i })).toBeVisible();
  await expect(page.getByRole('img')).toBeVisible();
  await expect(page.getByRole('link', { name: /download image/i })).toBeVisible();
});
```

- [ ] **Step 2: Run the test**

Run: `npx playwright test tests/e2e/recap-smoke.spec.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/recap-smoke.spec.ts
git commit -m "test: add Playwright smoke test for the recap card flow"
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

## Fast-follow (not part of this plan)

Once the product has enough traction to submit for TikTok/Meta app review, replace `fetchProfilePosts`'s Apify-scraping internals with official OAuth-backed calls (TikTok Content Posting/Display API, Instagram Graph API) — faster, more stable, and ToS-clean versus scraping. This is a contained swap behind `lib/recap/handler.ts`'s existing `ScraperClient` DI boundary, not a redesign of aggregation, rate-limiting, caching, or the card renderer. Track separately; kick off platform developer-app registration early given the multi-week review lead time. See spec decision #7 for the full reasoning.
