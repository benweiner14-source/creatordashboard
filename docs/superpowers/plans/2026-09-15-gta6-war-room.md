# GTA6 War Room Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a signed-in, subscribed creator a real-time feed of GTA6 content that's currently trending across YouTube, TikTok, and Instagram — detected by an hourly background scan, scored into Heating Up / Going Viral / Already Viral tiers, with opt-in email for the top two tiers and a one-click link into Content Ideas for each alert.

**Architecture:** Two new tables (`warroom_alerts`, the shared global feed and dedup memory in one; `warroom_settings`, a singleton pause flag) back a new `lib/warroom/` module. Three new discovery clients (`lib/warroom/discovery/{youtube,tiktok,instagram}.ts`) do platform-wide hashtag/keyword search — a capability none of this app's existing integrations have, since Recap Card/Strategy Breakdown/Watchlist all operate on a *known* handle. An hourly Vercel cron (`app/api/cron/warroom/route.ts`) runs a pure `runWarroomCron` handler that gates on a pause flag and a daily cap, discovers in parallel, scores, caps to 5 alerts/run, inserts with `ON CONFLICT DO NOTHING` dedup, and on an Apify-budget error pauses itself and emails the operator. A subscription-gated page (`/warroom`) shows the shared feed with an opt-in email checkbox; each alert links into `/ideas` with its caption pre-seeded as generation context.

**Tech Stack:** Next.js (App Router, TypeScript), Supabase (Postgres, Auth), Vitest + Testing Library, Playwright — same stack as the rest of the app. No new dependencies; the Apify-over-HTTP and Resend-over-HTTP patterns are already used elsewhere in this codebase.

**Spec:** `docs/superpowers/specs/2026-09-15-gta6-war-room-design.md`

## Global Constraints

- Platforms: YouTube, TikTok, Instagram only. No Twitter/X anywhere in this feature.
- Cadence: hourly cron (`0 * * * *`), not the reference system's every-10-minutes.
- Feed: one shared, global feed — no per-subscriber personalization or filtering.
- Delivery: in-app feed always; opt-in email fires only for `going_viral`/`already_viral` alerts, never `heating_up`.
- Gating: `/warroom` is subscription-gated (401 signed-out, 402 unsubscribed), same as Recap/Strategy/Ideas — not Watchlist's sign-in-only pattern.
- Dedup: permanent, via a `unique (platform, external_post_id)` constraint — a post that has ever alerted never alerts again.
- Daily cap: 30 alerts/day total (`WARROOM_DAILY_ALERT_CAP`), checked before scraping starts.
- Per-run cap: 5 alerts/run (`WARROOM_PER_RUN_CAP`), highest severity first.
- A post older than 48 hours is always dropped before scoring, regardless of tier.
- Apify budget-exhaustion detection reuses the reference system's exact regex: `/hard limit exceeded|platform-feature-disabled|monthly usage/i`. On a match: pause (`warroom_settings.paused = true`) and send exactly one operator email; do not insert any alerts from that run.
- Reactivation after a pause is manual (a direct SQL `update`, no admin route or UI) — not part of this plan.
- No curated "big account" profile-scraping tier — hashtag/keyword discovery only.
- No route unit tests — routes stay thin wiring, verified via handler unit tests + Playwright E2E, per this repo's convention.
- Reuses existing env vars `APIFY_API_TOKEN`, `RESEND_API_KEY`, `CRON_SECRET`, `YOUTUBE_API_KEY`; adds two new ones, `WARROOM_OPERATOR_EMAIL` and `WARROOM_FROM_EMAIL` (this codebase's convention is a per-feature `<FEATURE>_FROM_EMAIL`, e.g. the existing `DIGEST_FROM_EMAIL` — not a single shared "from" address).

---

## File Structure

```
supabase/migrations/
  20260915000001_create_warroom_tables.sql   # warroom_alerts + warroom_settings + profiles.warroom_email_opt_in

lib/
  supabase/
    types.ts                          # + warroom_alerts, warroom_settings Row/Insert/Update (modify)
  warroom/
    types.ts                          # WarroomPlatform, WarroomSeverity, DiscoveredPost, DiscoveryResult, WarroomAlertRow
    scoring.ts                        # classifySeverity
    discovery/
      youtube.ts                      # searchGta6Videos, normalizeYoutubeVideo
      tiktok.ts                       # searchGta6TikToks, normalizeTikTokPost
      instagram.ts                    # searchGta6InstagramPosts, normalizeInstagramPost
    cron-handler.ts                   # runWarroomCron
    handler.ts                        # handleListWarroomAlerts, handleWarroomOptIn
    page-state.ts                     # WarroomPageState/Event, reducer
  ideas/
    handler.ts                        # + optional `context` field on the request (modify)

app/
  page.tsx                            # + War Room link (modify)
  api/
    cron/
      warroom/route.ts                # GET, CRON_SECRET-authenticated
    warroom/
      route.ts                        # GET feed
      opt-in/route.ts                 # POST opt-in
  warroom/
    page.tsx                          # feed page
  ideas/
    page.tsx                          # + read `?context=` query param, thread into generate call (modify)

components/
  AppNav.tsx                          # + War Room nav link, right after Home (modify)

vercel.json                           # + warroom cron entry (modify)

tests/
  fakes/
    resend.fake.ts                    # createFakeEmailClient
  unit/
    supabase/
      migrations.test.ts              # + warroom cases (modify)
    lib/
      warroom/
        scoring.test.ts
        discovery/
          youtube.test.ts
          tiktok.test.ts
          instagram.test.ts
        cron-handler.test.ts
        handler.test.ts
        page-state.test.ts
      ideas/
        handler.test.ts               # + context field case (modify)
    app/
      page-content.test.tsx           # + War Room link case (modify)
      warroom/
        page.test.tsx
      ideas/
        page.test.tsx                 # + context prefill case (modify)
    components/
      AppNav.test.tsx                 # + War Room link case (modify)
  e2e/
    warroom-smoke.spec.ts
```

---

### Task 1: `warroom_alerts` + `warroom_settings` migration + Database types

**Files:**
- Create: `supabase/migrations/20260915000001_create_warroom_tables.sql`
- Modify: `lib/supabase/types.ts`
- Modify: `tests/unit/supabase/migrations.test.ts`

**Interfaces:**
- Consumes: `public.profiles`, the existing `public.diagnostic_platform` enum, the existing `readMigrationContaining` test helper
- Produces: `public.warroom_alerts`, `public.warroom_settings` tables; `public.profiles.warroom_email_opt_in` column; `Database['public']['Tables']['warroom_alerts']`, `Database['public']['Tables']['warroom_settings']` — relied on by Task 7 (cron route), Task 10 (feed/opt-in routes)

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/supabase/migrations.test.ts`, inside the existing `describe('supabase migrations', ...)` block:
```ts
  it('includes a warroom_alerts table migration deduplicated by platform and external post id', () => {
    const sql = readMigrationContaining('create_warroom_tables');
    expect(sql).toContain('create table public.warroom_alerts');
    expect(sql).toContain("severity text not null check (severity in ('heating_up', 'going_viral', 'already_viral'))");
    expect(sql).toContain('unique (platform, external_post_id)');
    expect(sql).toContain('"War Room alerts are viewable by any signed-in subscriber"');
    expect(sql).toContain('warroom_alerts_detected_at_idx');
  });

  it('includes a warroom_settings singleton table migration with no user-facing RLS policy', () => {
    const sql = readMigrationContaining('create_warroom_tables');
    expect(sql).toContain('create table public.warroom_settings');
    expect(sql).toContain('id boolean primary key default true check (id)');
    expect(sql).toContain('alter table public.warroom_settings enable row level security');
    // Checked as "no policy mentions warroom_settings" (not a bare
    // `not.toContain('create policy')`), since the migration file also
    // contains warroom_alerts' own, legitimate policy earlier in the same file.
    expect(sql).not.toMatch(/create policy[\s\S]*?on public\.warroom_settings/);
  });

  it('adds a warroom_email_opt_in column to profiles', () => {
    const sql = readMigrationContaining('create_warroom_tables');
    expect(sql).toContain('alter table public.profiles');
    expect(sql).toContain('add column warroom_email_opt_in boolean not null default false');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/supabase/migrations.test.ts`
Expected: FAIL with `No migration file matching "create_warroom_tables"`

- [ ] **Step 3: Write the migration**
```sql
-- supabase/migrations/20260915000001_create_warroom_tables.sql
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

create policy "War Room alerts are viewable by any signed-in subscriber"
  on public.warroom_alerts for select
  using ((select auth.uid()) is not null);

create index warroom_alerts_detected_at_idx
  on public.warroom_alerts (detected_at desc);

create table public.warroom_settings (
  id boolean primary key default true check (id),
  paused boolean not null default false,
  paused_reason text,
  paused_at timestamptz
);

insert into public.warroom_settings (id) values (true);

alter table public.warroom_settings enable row level security;
-- No select/insert/update policy for regular users: this table is
-- operational state, read and written only by the service-role client
-- (the cron route). RLS enabled with zero policies denies every
-- non-service-role query by default.

alter table public.profiles
  add column warroom_email_opt_in boolean not null default false;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/supabase/migrations.test.ts`
Expected: PASS (all three new tests, plus every pre-existing migration test still passing)

- [ ] **Step 5: Add Database types**

In `lib/supabase/types.ts`, find the `Tables` object and add two new entries alongside the existing ones (match the exact Row/Insert/Update shape convention already used for `watchlist_entries`/`watchlist_snapshots` in that file — Insert makes `id`/`detected_at` optional since they default; Update makes every field optional):
```ts
      warroom_alerts: {
        Row: {
          id: string;
          platform: Database['public']['Enums']['diagnostic_platform'];
          external_post_id: string;
          url: string;
          caption_or_title: string;
          view_count: number;
          engagement_count: number;
          published_at: string;
          severity: string;
          detected_at: string;
        };
        Insert: {
          id?: string;
          platform: Database['public']['Enums']['diagnostic_platform'];
          external_post_id: string;
          url: string;
          caption_or_title: string;
          view_count: number;
          engagement_count: number;
          published_at: string;
          severity: string;
          detected_at?: string;
        };
        Update: {
          id?: string;
          platform?: Database['public']['Enums']['diagnostic_platform'];
          external_post_id?: string;
          url?: string;
          caption_or_title?: string;
          view_count?: number;
          engagement_count?: number;
          published_at?: string;
          severity?: string;
          detected_at?: string;
        };
      };
      warroom_settings: {
        Row: { id: boolean; paused: boolean; paused_reason: string | null; paused_at: string | null };
        Insert: { id?: boolean; paused?: boolean; paused_reason?: string | null; paused_at?: string | null };
        Update: { id?: boolean; paused?: boolean; paused_reason?: string | null; paused_at?: string | null };
      };
```
Also find the `profiles` table's `Row`/`Insert`/`Update` entries and add `warroom_email_opt_in: boolean;` (Row) and `warroom_email_opt_in?: boolean;` (Insert/Update) to each, matching how `digest_email_opt_in` was previously added there.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260915000001_create_warroom_tables.sql lib/supabase/types.ts tests/unit/supabase/migrations.test.ts
git commit -m "feat(warroom): add warroom_alerts/warroom_settings tables + profiles opt-in column"
```

---

### Task 2: `lib/warroom/types.ts` + `lib/warroom/scoring.ts`

**Files:**
- Create: `lib/warroom/types.ts`
- Create: `lib/warroom/scoring.ts`
- Test: `tests/unit/lib/warroom/scoring.test.ts`

**Interfaces:**
- Consumes: `computeViewsPerHour` from `lib/metrics.ts` (already exists)
- Produces: `WarroomPlatform`, `WarroomSeverity`, `DiscoveredPost`, `DiscoveryResult`, `WarroomAlertRow` (all from `types.ts`); `classifySeverity(post: DiscoveredPost, now: Date): WarroomSeverity | null` (from `scoring.ts`) — relied on by Tasks 3-6

- [ ] **Step 1: Write `lib/warroom/types.ts`**
```ts
export type WarroomPlatform = 'youtube' | 'tiktok' | 'instagram';
export type WarroomSeverity = 'heating_up' | 'going_viral' | 'already_viral';

export interface DiscoveredPost {
  platform: WarroomPlatform;
  externalPostId: string;
  url: string;
  captionOrTitle: string;
  viewCount: number;
  engagementCount: number;
  publishedAt: string; // ISO 8601
}

/**
 * What a discovery client returns: the posts it successfully normalized,
 * plus any non-benign error strings it encountered (e.g. an Apify
 * budget-exhaustion message embedded in a dataset item rather than
 * surfaced as an HTTP failure). `errors` is always `[]` for a clean run —
 * every discovery client returns this same shape so the cron handler can
 * treat all three platforms uniformly instead of special-casing one.
 */
export interface DiscoveryResult {
  posts: DiscoveredPost[];
  errors: string[];
}

export interface WarroomAlertRow extends DiscoveredPost {
  id: string;
  severity: WarroomSeverity;
  detectedAt: string;
}
```

- [ ] **Step 2: Write the failing test for `scoring.ts`**

Create `tests/unit/lib/warroom/scoring.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { classifySeverity } from '@/lib/warroom/scoring';
import type { DiscoveredPost } from '@/lib/warroom/types';

const NOW = new Date('2026-09-15T12:00:00Z');

function post(overrides: Partial<DiscoveredPost> = {}): DiscoveredPost {
  return {
    platform: 'tiktok',
    externalPostId: 'p1',
    url: 'https://example.com/p1',
    captionOrTitle: 'A post',
    viewCount: 0,
    engagementCount: 0,
    publishedAt: '2026-09-15T11:00:00Z', // 1 hour before NOW
    ...overrides,
  };
}

describe('classifySeverity — TikTok', () => {
  it('classifies already_viral by view count regardless of the tier-specific age windows', () => {
    // 40 hours old -- well past the going_viral/heating_up windows (180min/240min),
    // but still inside the universal 48h cutoff, so already_viral's lack of an
    // extra age condition is what's being tested here, not the 48h cutoff itself.
    expect(classifySeverity(post({ viewCount: 1_000_000, publishedAt: '2026-09-13T20:00:00Z' }), NOW)).toBe('already_viral');
  });

  it('classifies going_viral by view count within the 180min window', () => {
    expect(classifySeverity(post({ viewCount: 300_000, publishedAt: '2026-09-15T10:00:00Z' }), NOW)).toBe('going_viral');
  });

  it('does not classify going_viral once the 180min window has passed', () => {
    expect(classifySeverity(post({ viewCount: 300_000, publishedAt: '2026-09-15T08:00:00Z' }), NOW)).not.toBe('going_viral');
  });

  it('classifies heating_up by engagement within the 240min window', () => {
    expect(classifySeverity(post({ engagementCount: 2_000, publishedAt: '2026-09-15T09:00:00Z' }), NOW)).toBe('heating_up');
  });

  it('returns null for a post below every threshold', () => {
    expect(classifySeverity(post({ viewCount: 100, engagementCount: 10 }), NOW)).toBeNull();
  });
});

describe('classifySeverity — Instagram', () => {
  it('classifies already_viral by engagement regardless of the tier-specific age windows', () => {
    // 40 hours old -- past going_viral/heating_up's own windows (120min/180min),
    // still inside the universal 48h cutoff.
    expect(classifySeverity(post({ platform: 'instagram', engagementCount: 15_000, publishedAt: '2026-09-13T20:00:00Z' }), NOW)).toBe(
      'already_viral'
    );
  });

  it('classifies going_viral by engagement within the 120min window', () => {
    expect(classifySeverity(post({ platform: 'instagram', engagementCount: 6_000, publishedAt: '2026-09-15T11:00:00Z' }), NOW)).toBe(
      'going_viral'
    );
  });

  it('classifies heating_up by engagement within the 180min window', () => {
    expect(classifySeverity(post({ platform: 'instagram', engagementCount: 2_500, publishedAt: '2026-09-15T09:30:00Z' }), NOW)).toBe(
      'heating_up'
    );
  });
});

describe('classifySeverity — YouTube', () => {
  it('classifies already_viral by total views regardless of viewsPerHour', () => {
    // 47 hours old (just inside the 48h cutoff): 200,000 views / 47h ≈ 4255
    // views/hour, which is BELOW the 5000 viewsPerHour threshold -- so this
    // isolates the "views >= 200,000" branch of already_viral, proving it
    // triggers independent of viewsPerHour, without also tripping the 48h cutoff.
    expect(
      classifySeverity(post({ platform: 'youtube', viewCount: 200_000, publishedAt: '2026-09-13T13:00:00Z' }), NOW)
    ).toBe('already_viral');
  });

  it('classifies going_viral by views-per-hour within 12h', () => {
    // 2 hours old, 4400 views -> 2200 views/hour
    expect(classifySeverity(post({ platform: 'youtube', viewCount: 4_400, publishedAt: '2026-09-15T10:00:00Z' }), NOW)).toBe(
      'going_viral'
    );
  });

  it('classifies heating_up by views-per-hour within 24h', () => {
    // 10 hours old, 6000 views -> 600 views/hour
    expect(classifySeverity(post({ platform: 'youtube', viewCount: 6_000, publishedAt: '2026-09-15T02:00:00Z' }), NOW)).toBe(
      'heating_up'
    );
  });
});

describe('classifySeverity — global age cutoff', () => {
  it('returns null for a post older than 48 hours even at already_viral magnitude', () => {
    expect(
      classifySeverity(post({ platform: 'instagram', engagementCount: 999_999, publishedAt: '2026-09-10T00:00:00Z' }), NOW)
    ).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/warroom/scoring.test.ts`
Expected: FAIL — `Cannot find module '@/lib/warroom/scoring'`

- [ ] **Step 4: Write `lib/warroom/scoring.ts`**
```ts
import { computeViewsPerHour } from '@/lib/metrics';
import type { DiscoveredPost, WarroomSeverity } from './types';

const MS_PER_MINUTE = 60 * 1000;
const MAX_AGE_MINUTES = 48 * 60;

function ageMinutes(publishedAt: string, now: Date): number {
  const publishedMs = new Date(publishedAt).getTime();
  if (!Number.isFinite(publishedMs)) return Infinity;
  return (now.getTime() - publishedMs) / MS_PER_MINUTE;
}

/**
 * Thresholds for TikTok/Instagram are the reference Social War Room
 * system's real, tuned "Standard" tier (see design spec §3) — this build
 * only does hashtag/keyword discovery, so the reference's separate "big
 * account" tier (for a curated list of known profiles) does not apply.
 * YouTube has no reference precedent and uses this codebase's own
 * computeViewsPerHour, the same function Watchlist/Recap/Strategy use.
 *
 * A post older than 48 hours is dropped before any tier check runs, full
 * stop — "(no age limit)" on an individual tier below means that tier's
 * own numeric threshold carries no *additional* age condition beyond this
 * universal cutoff, not that the tier is literally unbounded in age.
 */
export function classifySeverity(post: DiscoveredPost, now: Date): WarroomSeverity | null {
  const ageMin = ageMinutes(post.publishedAt, now);
  if (ageMin > MAX_AGE_MINUTES) return null;

  if (post.platform === 'tiktok') {
    if (post.viewCount >= 1_000_000 || post.engagementCount >= 20_000) return 'already_viral';
    if ((post.viewCount >= 300_000 || post.engagementCount >= 8_000) && ageMin <= 180) return 'going_viral';
    if ((post.viewCount >= 100_000 || post.engagementCount >= 2_000) && ageMin <= 240) return 'heating_up';
    return null;
  }

  if (post.platform === 'instagram') {
    if (post.engagementCount >= 15_000) return 'already_viral';
    if (post.engagementCount >= 6_000 && ageMin <= 120) return 'going_viral';
    if (post.engagementCount >= 2_500 && ageMin <= 180) return 'heating_up';
    return null;
  }

  // youtube
  const viewsPerHour = computeViewsPerHour(post.viewCount, post.publishedAt, now);
  if (viewsPerHour >= 5_000 || post.viewCount >= 200_000) return 'already_viral';
  if (viewsPerHour >= 2_000 && ageMin < 12 * 60) return 'going_viral';
  if (viewsPerHour >= 500 && ageMin < 24 * 60) return 'heating_up';
  return null;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/warroom/scoring.test.ts`
Expected: PASS (all cases)

- [ ] **Step 6: Commit**

```bash
git add lib/warroom/types.ts lib/warroom/scoring.ts tests/unit/lib/warroom/scoring.test.ts
git commit -m "feat(warroom): add shared types and per-platform virality scoring"
```

---

### Task 3: `lib/warroom/discovery/youtube.ts`

**Files:**
- Create: `lib/warroom/discovery/youtube.ts`
- Test: `tests/unit/lib/warroom/discovery/youtube.test.ts`

**Interfaces:**
- Consumes: `DiscoveredPost`, `DiscoveryResult` from `lib/warroom/types.ts` (Task 2)
- Produces: `searchGta6Videos(apiKey: string, publishedAfter: Date): Promise<DiscoveryResult>`, `normalizeYoutubeVideo` (exported for its own unit tests) — relied on by Task 6 (cron handler)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/lib/warroom/discovery/youtube.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { searchGta6Videos, normalizeYoutubeVideo } from '@/lib/warroom/discovery/youtube';

describe('normalizeYoutubeVideo', () => {
  it('maps a YouTube videos.list item to a DiscoveredPost', () => {
    const result = normalizeYoutubeVideo({
      id: 'abc123',
      snippet: { title: 'GTA 6 trailer breakdown', publishedAt: '2026-09-15T10:00:00Z' },
      statistics: { viewCount: '5000', likeCount: '400', commentCount: '50' },
    });
    expect(result).toEqual({
      platform: 'youtube',
      externalPostId: 'abc123',
      url: 'https://www.youtube.com/watch?v=abc123',
      captionOrTitle: 'GTA 6 trailer breakdown',
      viewCount: 5000,
      engagementCount: 450,
      publishedAt: '2026-09-15T10:00:00Z',
    });
  });

  it('defaults missing statistics fields to 0 rather than NaN', () => {
    const result = normalizeYoutubeVideo({
      id: 'abc123',
      snippet: { title: 'x', publishedAt: '2026-09-15T10:00:00Z' },
      statistics: {},
    });
    expect(result.viewCount).toBe(0);
    expect(result.engagementCount).toBe(0);
  });
});

describe('searchGta6Videos', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls search.list then videos.list and returns normalized posts with no errors', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/search')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ items: [{ id: { videoId: 'v1' } }] }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          items: [
            {
              id: 'v1',
              snippet: { title: 'GTA 6 news', publishedAt: '2026-09-15T10:00:00Z' },
              statistics: { viewCount: '100', likeCount: '10', commentCount: '2' },
            },
          ],
        }),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await searchGta6Videos('test-key', new Date('2026-09-15T00:00:00Z'));

    expect(result.errors).toEqual([]);
    expect(result.posts).toHaveLength(1);
    expect(result.posts[0].externalPostId).toBe('v1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns no posts and does not call videos.list when search.list finds nothing', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await searchGta6Videos('test-key', new Date('2026-09-15T00:00:00Z'));

    expect(result.posts).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws when search.list responds with a non-2xx status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    await expect(searchGta6Videos('test-key', new Date())).rejects.toThrow('status 403');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/warroom/discovery/youtube.test.ts`
Expected: FAIL — `Cannot find module '@/lib/warroom/discovery/youtube'`

- [ ] **Step 3: Write `lib/warroom/discovery/youtube.ts`**
```ts
import type { DiscoveredPost, DiscoveryResult } from '../types';

const GTA6_QUERY = '"GTA 6" OR "GTA VI" OR "Grand Theft Auto 6"';

interface YoutubeSearchItem {
  id: { videoId: string };
}

interface YoutubeVideoItem {
  id: string;
  snippet: { title: string; publishedAt: string };
  statistics: { viewCount?: string; likeCount?: string; commentCount?: string };
}

export function normalizeYoutubeVideo(item: YoutubeVideoItem): DiscoveredPost {
  const viewCount = Number(item.statistics.viewCount ?? 0);
  const likeCount = Number(item.statistics.likeCount ?? 0);
  const commentCount = Number(item.statistics.commentCount ?? 0);
  return {
    platform: 'youtube',
    externalPostId: item.id,
    url: `https://www.youtube.com/watch?v=${item.id}`,
    captionOrTitle: item.snippet.title,
    viewCount,
    engagementCount: likeCount + commentCount,
    publishedAt: item.snippet.publishedAt,
  };
}

/**
 * Two-call shape, matching lib/integrations/youtube.ts's existing
 * convention of a separate call per capability rather than widening one
 * call's `part` param: search.list finds candidate video IDs (100 quota
 * units), videos.list fetches their stats (1 unit). At hourly cadence
 * this stays well under the default 10,000/day quota — see design spec §2.
 */
export async function searchGta6Videos(apiKey: string, publishedAfter: Date): Promise<DiscoveryResult> {
  const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
  searchUrl.searchParams.set('part', 'id');
  searchUrl.searchParams.set('q', GTA6_QUERY);
  searchUrl.searchParams.set('type', 'video');
  searchUrl.searchParams.set('order', 'date');
  searchUrl.searchParams.set('publishedAfter', publishedAfter.toISOString());
  searchUrl.searchParams.set('maxResults', '25');
  searchUrl.searchParams.set('key', apiKey);

  const searchResponse = await fetch(searchUrl.toString());
  if (!searchResponse.ok) {
    throw new Error(`YouTube search.list request failed with status ${searchResponse.status}`);
  }
  const searchData = await searchResponse.json();
  const videoIds: string[] = (searchData.items ?? [])
    .map((item: YoutubeSearchItem) => item.id?.videoId)
    .filter((id: string | undefined): id is string => Boolean(id));

  if (videoIds.length === 0) return { posts: [], errors: [] };

  const videosUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
  videosUrl.searchParams.set('part', 'snippet,statistics');
  videosUrl.searchParams.set('id', videoIds.join(','));
  videosUrl.searchParams.set('key', apiKey);

  const videosResponse = await fetch(videosUrl.toString());
  if (!videosResponse.ok) {
    throw new Error(`YouTube videos.list request failed with status ${videosResponse.status}`);
  }
  const videosData = await videosResponse.json();
  const posts = (videosData.items ?? []).map((item: YoutubeVideoItem) => normalizeYoutubeVideo(item));

  return { posts, errors: [] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/warroom/discovery/youtube.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/warroom/discovery/youtube.ts tests/unit/lib/warroom/discovery/youtube.test.ts
git commit -m "feat(warroom): add YouTube GTA6 video discovery"
```

---

### Task 4: `lib/warroom/discovery/tiktok.ts`

**Files:**
- Create: `lib/warroom/discovery/tiktok.ts`
- Test: `tests/unit/lib/warroom/discovery/tiktok.test.ts`

**Interfaces:**
- Consumes: `DiscoveredPost`, `DiscoveryResult` from `lib/warroom/types.ts` (Task 2)
- Produces: `searchGta6TikToks(apifyToken: string): Promise<DiscoveryResult>`, `normalizeTikTokPost` — relied on by Task 6

- [ ] **Step 1: Write the failing test**

Create `tests/unit/lib/warroom/discovery/tiktok.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { searchGta6TikToks, normalizeTikTokPost } from '@/lib/warroom/discovery/tiktok';

describe('normalizeTikTokPost', () => {
  it('maps a raw TikTok scraper item to a DiscoveredPost', () => {
    const result = normalizeTikTokPost({
      id: '123',
      playCount: 50000,
      diggCount: 4000,
      commentCount: 100,
      shareCount: 200,
      text: 'GTA 6 gameplay leak?!',
      webVideoUrl: 'https://www.tiktok.com/@someone/video/123',
      authorMeta: { uniqueId: 'someone' },
      createTime: 1757930400, // 2025-09-15T10:00:00Z
    });
    expect(result).toEqual({
      platform: 'tiktok',
      externalPostId: '123',
      url: 'https://www.tiktok.com/@someone/video/123',
      captionOrTitle: 'GTA 6 gameplay leak?!',
      viewCount: 50000,
      engagementCount: 4300,
      publishedAt: new Date(1757930400 * 1000).toISOString(),
    });
  });

  it('returns null for an item missing an id or createTime', () => {
    expect(normalizeTikTokPost({ playCount: 100 })).toBeNull();
  });
});

describe('searchGta6TikToks', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns normalized posts and skips benign error items without reporting them', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          { id: '1', playCount: 100, diggCount: 10, commentCount: 1, createTime: 1757930400, authorMeta: { uniqueId: 'a' } },
          { error: 'not_found' },
        ],
      })
    );

    const result = await searchGta6TikToks('test-token');

    expect(result.posts).toHaveLength(1);
    expect(result.errors).toEqual([]);
  });

  it('reports a non-benign error item without throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [{ error: 'Apify hard limit exceeded for this month' }],
      })
    );

    const result = await searchGta6TikToks('test-token');

    expect(result.posts).toEqual([]);
    expect(result.errors).toEqual(['Apify hard limit exceeded for this month']);
  });

  it('throws when the Apify request itself responds with a non-2xx status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(searchGta6TikToks('test-token')).rejects.toThrow('status 500');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/warroom/discovery/tiktok.test.ts`
Expected: FAIL — `Cannot find module '@/lib/warroom/discovery/tiktok'`

- [ ] **Step 3: Write `lib/warroom/discovery/tiktok.ts`**
```ts
import type { DiscoveredPost, DiscoveryResult } from '../types';

// Same class of benign, non-failure markers the reference Social War Room
// system's Health Check ignores (design spec §2/§4) — a "no results found"
// or "page restricted" item is not a scraper failure.
const BENIGN_ERRORS = new Set(['not_found', 'no_items', 'restricted_page']);

interface RawTikTokItem {
  id?: string | number;
  playCount?: number;
  diggCount?: number;
  commentCount?: number;
  shareCount?: number;
  text?: string;
  webVideoUrl?: string;
  authorMeta?: { uniqueId?: string };
  createTime?: number;
  error?: string;
}

export function normalizeTikTokPost(item: RawTikTokItem): DiscoveredPost | null {
  if (!item.id || !item.createTime) return null;
  const views = item.playCount ?? 0;
  const likes = item.diggCount ?? 0;
  const comments = item.commentCount ?? 0;
  const shares = item.shareCount ?? 0;
  const handle = item.authorMeta?.uniqueId ?? 'unknown';
  const videoId = String(item.id);
  return {
    platform: 'tiktok',
    externalPostId: videoId,
    url: item.webVideoUrl ?? `https://www.tiktok.com/@${handle}/video/${videoId}`,
    captionOrTitle: (item.text ?? '').slice(0, 300),
    viewCount: views,
    engagementCount: likes + comments + shares,
    publishedAt: new Date(item.createTime * 1000).toISOString(),
  };
}

/**
 * Same actor and call shape as the reference Social War Room system
 * (design spec §2), GTA6 keywords substituted for NBA2K's.
 */
export async function searchGta6TikToks(apifyToken: string): Promise<DiscoveryResult> {
  const url = new URL('https://api.apify.com/v2/acts/clockworks~tiktok-scraper/run-sync-get-dataset-items');
  url.searchParams.set('token', apifyToken);
  url.searchParams.set('maxItems', '30');
  url.searchParams.set('timeout', '90');

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      hashtags: ['gta6', 'gta 6', 'grandtheftauto6', 'gtavi'],
      searchQueries: ['GTA 6', 'GTA VI', 'Grand Theft Auto 6'],
      maxItems: 30,
      shouldDownloadVideos: false,
      shouldDownloadCovers: false,
      publishTime: 'LAST_24H',
    }),
  });
  if (!response.ok) {
    throw new Error(`Apify TikTok scraper request failed with status ${response.status}`);
  }
  const items: RawTikTokItem[] = await response.json();

  const posts: DiscoveredPost[] = [];
  const errors: string[] = [];
  for (const item of items) {
    if (item.error) {
      if (!BENIGN_ERRORS.has(item.error)) errors.push(item.error);
      continue;
    }
    const normalized = normalizeTikTokPost(item);
    if (normalized) posts.push(normalized);
  }
  return { posts, errors };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/warroom/discovery/tiktok.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/warroom/discovery/tiktok.ts tests/unit/lib/warroom/discovery/tiktok.test.ts
git commit -m "feat(warroom): add TikTok GTA6 hashtag discovery"
```

---

### Task 5: `lib/warroom/discovery/instagram.ts`

**Files:**
- Create: `lib/warroom/discovery/instagram.ts`
- Test: `tests/unit/lib/warroom/discovery/instagram.test.ts`

**Interfaces:**
- Consumes: `DiscoveredPost`, `DiscoveryResult` from `lib/warroom/types.ts` (Task 2)
- Produces: `searchGta6InstagramPosts(apifyToken: string): Promise<DiscoveryResult>`, `normalizeInstagramPost` — relied on by Task 6

- [ ] **Step 1: Write the failing test**

Create `tests/unit/lib/warroom/discovery/instagram.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { searchGta6InstagramPosts, normalizeInstagramPost } from '@/lib/warroom/discovery/instagram';

describe('normalizeInstagramPost', () => {
  it('maps a raw Instagram hashtag-scraper item to a DiscoveredPost', () => {
    const result = normalizeInstagramPost({
      shortCode: 'ABC123',
      likesCount: 5000,
      commentsCount: 300,
      videoViewCount: 40000,
      url: 'https://www.instagram.com/p/ABC123/',
      caption: 'GTA 6 leak??',
      timestamp: '2026-09-15T10:00:00.000Z',
      ownerUsername: 'someone',
    });
    expect(result).toEqual({
      platform: 'instagram',
      externalPostId: 'ABC123',
      url: 'https://www.instagram.com/p/ABC123/',
      captionOrTitle: 'GTA 6 leak??',
      viewCount: 40000,
      engagementCount: 5300,
      publishedAt: '2026-09-15T10:00:00.000Z',
    });
  });

  it('falls back to a constructed url and a numeric unix timestamp field', () => {
    const result = normalizeInstagramPost({
      shortCode: 'XYZ',
      likesCount: 10,
      commentsCount: 1,
      takenAtTimestamp: 1757930400,
    });
    expect(result?.url).toBe('https://www.instagram.com/p/XYZ/');
    expect(result?.publishedAt).toBe(new Date(1757930400 * 1000).toISOString());
  });

  it('returns null for an item missing a shortCode/id or any timestamp', () => {
    expect(normalizeInstagramPost({ likesCount: 10 })).toBeNull();
  });
});

describe('searchGta6InstagramPosts', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns normalized posts and skips benign error items without reporting them', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          { shortCode: 'A', likesCount: 10, commentsCount: 1, timestamp: '2026-09-15T10:00:00Z' },
          { error: 'restricted_page' },
        ],
      })
    );

    const result = await searchGta6InstagramPosts('test-token');

    expect(result.posts).toHaveLength(1);
    expect(result.errors).toEqual([]);
  });

  it('reports a non-benign error item without throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => [{ error: 'monthly usage limit reached' }] })
    );

    const result = await searchGta6InstagramPosts('test-token');

    expect(result.posts).toEqual([]);
    expect(result.errors).toEqual(['monthly usage limit reached']);
  });

  it('throws when the Apify request itself responds with a non-2xx status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }));
    await expect(searchGta6InstagramPosts('test-token')).rejects.toThrow('status 429');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/warroom/discovery/instagram.test.ts`
Expected: FAIL — `Cannot find module '@/lib/warroom/discovery/instagram'`

- [ ] **Step 3: Write `lib/warroom/discovery/instagram.ts`**
```ts
import type { DiscoveredPost, DiscoveryResult } from '../types';

const BENIGN_ERRORS = new Set(['not_found', 'no_items', 'restricted_page']);

interface RawInstagramItem {
  shortCode?: string;
  id?: string;
  likesCount?: number;
  likeCount?: number;
  commentsCount?: number;
  commentCount?: number;
  videoViewCount?: number;
  viewsCount?: number;
  url?: string;
  caption?: string;
  timestamp?: string | number;
  takenAtTimestamp?: number;
  ownerUsername?: string;
  error?: string;
}

export function normalizeInstagramPost(item: RawInstagramItem): DiscoveredPost | null {
  const shortCode = item.shortCode ?? item.id;
  const ts = item.timestamp ?? item.takenAtTimestamp;
  if (!shortCode || !ts) return null;
  const likes = item.likesCount ?? item.likeCount ?? 0;
  const comments = item.commentsCount ?? item.commentCount ?? 0;
  const views = item.videoViewCount ?? item.viewsCount ?? 0;
  const publishedMs = typeof ts === 'number' ? ts * 1000 : new Date(ts).getTime();
  return {
    platform: 'instagram',
    externalPostId: shortCode,
    url: item.url ?? `https://www.instagram.com/p/${shortCode}/`,
    captionOrTitle: (item.caption ?? '').slice(0, 300),
    viewCount: views,
    engagementCount: likes + comments,
    publishedAt: new Date(publishedMs).toISOString(),
  };
}

/** Same actor and call shape as the reference system (design spec §2). */
export async function searchGta6InstagramPosts(apifyToken: string): Promise<DiscoveryResult> {
  const url = new URL('https://api.apify.com/v2/acts/apify~instagram-hashtag-scraper/run-sync-get-dataset-items');
  url.searchParams.set('token', apifyToken);
  url.searchParams.set('maxItems', '50');
  url.searchParams.set('timeout', '90');

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hashtags: ['gta6', 'gtavi', 'grandtheftauto6'], resultsLimit: 50, searchType: 'hashtag' }),
  });
  if (!response.ok) {
    throw new Error(`Apify Instagram scraper request failed with status ${response.status}`);
  }
  const items: RawInstagramItem[] = await response.json();

  const posts: DiscoveredPost[] = [];
  const errors: string[] = [];
  for (const item of items) {
    if (item.error) {
      if (!BENIGN_ERRORS.has(item.error)) errors.push(item.error);
      continue;
    }
    const normalized = normalizeInstagramPost(item);
    if (normalized) posts.push(normalized);
  }
  return { posts, errors };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/warroom/discovery/instagram.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/warroom/discovery/instagram.ts tests/unit/lib/warroom/discovery/instagram.test.ts
git commit -m "feat(warroom): add Instagram GTA6 hashtag discovery"
```

---

### Task 6: `lib/warroom/cron-handler.ts` — `runWarroomCron`

**Files:**
- Create: `lib/warroom/cron-handler.ts`
- Create: `tests/fakes/resend.fake.ts`
- Test: `tests/unit/lib/warroom/cron-handler.test.ts`

**Interfaces:**
- Consumes: `DiscoveredPost`, `DiscoveryResult`, `WarroomSeverity` from `lib/warroom/types.ts` (Task 2); `classifySeverity` from `lib/warroom/scoring.ts` (Task 2); `EmailClient` from `lib/integrations/resend.ts` (existing)
- Produces: `WarroomCronDeps`, `WarroomCronResult`, `WARROOM_DAILY_ALERT_CAP`, `WARROOM_PER_RUN_CAP`, `runWarroomCron(deps, now): Promise<WarroomCronResult>` — relied on by Task 7 (cron route)

- [ ] **Step 1: Write the fake email client**

Create `tests/fakes/resend.fake.ts`:
```ts
import type { EmailClient } from '@/lib/integrations/resend';

export interface SentEmail {
  to: string;
  subject: string;
  html: string;
}

export function createFakeEmailClient(): { client: EmailClient; sent: SentEmail[] } {
  const sent: SentEmail[] = [];
  return {
    sent,
    client: {
      async sendEmail(params) {
        sent.push(params);
      },
    },
  };
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/unit/lib/warroom/cron-handler.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { runWarroomCron, WARROOM_DAILY_ALERT_CAP, WARROOM_PER_RUN_CAP, type WarroomCronDeps } from '@/lib/warroom/cron-handler';
import { createFakeEmailClient } from '../../../fakes/resend.fake';
import type { DiscoveredPost, DiscoveryResult, WarroomSeverity } from '@/lib/warroom/types';

const NOW = new Date('2026-09-15T12:00:00Z');

function post(overrides: Partial<DiscoveredPost> = {}): DiscoveredPost {
  return {
    platform: 'youtube',
    externalPostId: 'p1',
    url: 'https://example.com/p1',
    captionOrTitle: 'GTA 6 news',
    viewCount: 300_000, // already_viral on YouTube regardless of age
    engagementCount: 1000,
    publishedAt: '2026-09-15T11:00:00Z',
    ...overrides,
  };
}

function emptyResult(): DiscoveryResult {
  return { posts: [], errors: [] };
}

function makeDeps(overrides: Partial<WarroomCronDeps> = {}): { deps: WarroomCronDeps; inserted: Array<{ post: DiscoveredPost; severity: WarroomSeverity }> } {
  const inserted: Array<{ post: DiscoveredPost; severity: WarroomSeverity }> = [];
  const { client } = createFakeEmailClient();
  const deps: WarroomCronDeps = {
    isPaused: async () => false,
    countAlertsToday: async () => 0,
    discoverYoutube: async () => emptyResult(),
    discoverTikTok: async () => emptyResult(),
    discoverInstagram: async () => emptyResult(),
    insertAlert: async ({ post: p, severity }) => {
      inserted.push({ post: p, severity });
      return { inserted: true };
    },
    pauseForBudget: async () => {},
    getOptedInEmails: async () => [],
    emailClient: client,
    operatorEmail: 'operator@example.com',
    ...overrides,
  };
  return { deps, inserted };
}

describe('runWarroomCron', () => {
  it('does nothing when already paused', async () => {
    const { deps } = makeDeps({ isPaused: async () => true, discoverYoutube: () => { throw new Error('should not be called'); } });
    const result = await runWarroomCron(deps, NOW);
    expect(result).toEqual({ skipped: 'paused', inserted: 0 });
  });

  it('does nothing once the daily cap is reached', async () => {
    const { deps } = makeDeps({
      countAlertsToday: async () => WARROOM_DAILY_ALERT_CAP,
      discoverYoutube: () => { throw new Error('should not be called'); },
    });
    const result = await runWarroomCron(deps, NOW);
    expect(result).toEqual({ skipped: 'daily_cap', inserted: 0 });
  });

  it('inserts a post that crosses a threshold', async () => {
    const { deps, inserted } = makeDeps({ discoverYoutube: async () => ({ posts: [post()], errors: [] }) });
    const result = await runWarroomCron(deps, NOW);
    expect(result.inserted).toBe(1);
    expect(inserted[0].severity).toBe('already_viral');
  });

  it('drops a post that scores no severity', async () => {
    const { deps, inserted } = makeDeps({
      discoverYoutube: async () => ({ posts: [post({ viewCount: 10, engagementCount: 1 })], errors: [] }),
    });
    await runWarroomCron(deps, NOW);
    expect(inserted).toHaveLength(0);
  });

  it('continues processing when one platform rejects', async () => {
    const { deps, inserted } = makeDeps({
      discoverYoutube: async () => ({ posts: [post()], errors: [] }),
      discoverTikTok: async () => { throw new Error('tiktok is down'); },
    });
    const result = await runWarroomCron(deps, NOW);
    expect(result.inserted).toBe(1);
    expect(inserted).toHaveLength(1);
  });

  it('caps a single run to WARROOM_PER_RUN_CAP alerts', async () => {
    const manyPosts = Array.from({ length: WARROOM_PER_RUN_CAP + 3 }, (_, i) =>
      post({ externalPostId: `p${i}`, viewCount: 300_000 })
    );
    const { deps, inserted } = makeDeps({ discoverYoutube: async () => ({ posts: manyPosts, errors: [] }) });
    const result = await runWarroomCron(deps, NOW);
    expect(result.inserted).toBe(WARROOM_PER_RUN_CAP);
    expect(inserted).toHaveLength(WARROOM_PER_RUN_CAP);
  });

  it('keeps only the highest-severity alerts when discovery finds more than the per-run cap', async () => {
    // 2 already_viral + 3 going_viral = exactly WARROOM_PER_RUN_CAP (5); 3 heating_up
    // posts are also found but must all be dropped -- this is the only test that
    // would fail if the cap's severity sort were ever inverted or removed, since
    // the count-only cap test above passes regardless of sort order.
    const alreadyViral = [
      post({ externalPostId: 'av0', viewCount: 1_000_000, publishedAt: '2026-09-15T10:00:00Z' }), // 2h old
      post({ externalPostId: 'av1', viewCount: 1_000_000, publishedAt: '2026-09-15T10:00:00Z' }),
    ];
    const goingViral = [
      post({ externalPostId: 'gv0', viewCount: 4_400, publishedAt: '2026-09-15T10:00:00Z' }), // 2h old, 2200 views/hr
      post({ externalPostId: 'gv1', viewCount: 4_400, publishedAt: '2026-09-15T10:00:00Z' }),
      post({ externalPostId: 'gv2', viewCount: 4_400, publishedAt: '2026-09-15T10:00:00Z' }),
    ];
    const heatingUp = [
      post({ externalPostId: 'hu0', viewCount: 6_000, publishedAt: '2026-09-15T02:00:00Z' }), // 10h old, 600 views/hr
      post({ externalPostId: 'hu1', viewCount: 6_000, publishedAt: '2026-09-15T02:00:00Z' }),
      post({ externalPostId: 'hu2', viewCount: 6_000, publishedAt: '2026-09-15T02:00:00Z' }),
    ];
    const { deps, inserted } = makeDeps({
      discoverYoutube: async () => ({ posts: [...alreadyViral, ...goingViral, ...heatingUp], errors: [] }),
    });
    const result = await runWarroomCron(deps, NOW);
    expect(result.inserted).toBe(WARROOM_PER_RUN_CAP);
    const insertedIds = inserted.map((c) => c.post.externalPostId).sort();
    expect(insertedIds).toEqual(['av0', 'av1', 'gv0', 'gv1', 'gv2']);
  });

  it('deduplicates identical (platform, externalPostId) pairs within a single run', async () => {
    const duplicate = post();
    const { deps, inserted } = makeDeps({ discoverYoutube: async () => ({ posts: [duplicate, { ...duplicate }], errors: [] }) });
    await runWarroomCron(deps, NOW);
    expect(inserted).toHaveLength(1);
  });

  it('pauses and sends exactly one operator email when a budget-exceeded error is detected, without inserting anything', async () => {
    const { client, sent } = createFakeEmailClient();
    const pauseForBudget = vi.fn();
    const { deps, inserted } = makeDeps({
      discoverYoutube: async () => ({ posts: [post()], errors: [] }),
      discoverTikTok: async () => ({ posts: [], errors: ['Apify hard limit exceeded for this month'] }),
      pauseForBudget,
      emailClient: client,
    });

    const result = await runWarroomCron(deps, NOW);

    expect(result.skipped).toBe('budget_exceeded');
    expect(pauseForBudget).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('operator@example.com');
    expect(inserted).toHaveLength(0);
  });

  it('does not pause on a non-budget error, and still inserts alerts found elsewhere', async () => {
    const { deps, inserted } = makeDeps({
      discoverYoutube: async () => ({ posts: [post()], errors: [] }),
      discoverTikTok: async () => ({ posts: [], errors: ['some transient scraper error'] }),
      pauseForBudget: () => { throw new Error('should not be called'); },
    });
    const result = await runWarroomCron(deps, NOW);
    expect(result.skipped).toBeNull();
    expect(inserted).toHaveLength(1);
  });

  it('emails every opted-in subscriber for a going_viral or already_viral alert', async () => {
    const { client, sent } = createFakeEmailClient();
    const { deps } = makeDeps({
      discoverYoutube: async () => ({ posts: [post()], errors: [] }), // already_viral
      getOptedInEmails: async () => ['a@example.com', 'b@example.com'],
      emailClient: client,
    });
    await runWarroomCron(deps, NOW);
    expect(sent).toHaveLength(2);
    expect(sent.map((e) => e.to).sort()).toEqual(['a@example.com', 'b@example.com']);
  });

  it('emails opted-in subscribers for a going_viral-only alert, not just already_viral', async () => {
    // The other email test above only ever uses an already_viral post, so it
    // can't catch a future edit that narrowed the fan-out filter to
    // already_viral alone -- this specifically proves going_viral qualifies too.
    const { client, sent } = createFakeEmailClient();
    const goingViralPost = post({ viewCount: 4_400, publishedAt: '2026-09-15T10:00:00Z' }); // youtube going_viral
    const { deps } = makeDeps({
      discoverYoutube: async () => ({ posts: [goingViralPost], errors: [] }),
      getOptedInEmails: async () => ['a@example.com'],
      emailClient: client,
    });
    await runWarroomCron(deps, NOW);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('a@example.com');
  });

  it('does not email opted-in subscribers for a heating_up-only alert', async () => {
    const { client, sent } = createFakeEmailClient();
    const heatingUpPost = post({ viewCount: 6_000, publishedAt: '2026-09-15T02:00:00Z' }); // youtube heating_up
    const { deps } = makeDeps({
      discoverYoutube: async () => ({ posts: [heatingUpPost], errors: [] }),
      getOptedInEmails: async () => ['a@example.com'],
      emailClient: client,
    });
    await runWarroomCron(deps, NOW);
    expect(sent).toHaveLength(0);
  });

  it('does not re-email for an alert insertAlert reports as an existing duplicate', async () => {
    const { client, sent } = createFakeEmailClient();
    const { deps } = makeDeps({
      discoverYoutube: async () => ({ posts: [post()], errors: [] }),
      insertAlert: async () => ({ inserted: false }), // already existed
      getOptedInEmails: async () => ['a@example.com'],
      emailClient: client,
    });
    await runWarroomCron(deps, NOW);
    expect(sent).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/warroom/cron-handler.test.ts`
Expected: FAIL — `Cannot find module '@/lib/warroom/cron-handler'`

- [ ] **Step 4: Write `lib/warroom/cron-handler.ts`**
```ts
import type { EmailClient } from '@/lib/integrations/resend';
import { classifySeverity } from './scoring';
import type { DiscoveredPost, DiscoveryResult, WarroomSeverity } from './types';

/** Reused verbatim from the reference Social War Room system — design spec §4. */
const BUDGET_EXCEEDED_RE = /hard limit exceeded|platform-feature-disabled|monthly usage/i;

export const WARROOM_DAILY_ALERT_CAP = 30;
export const WARROOM_PER_RUN_CAP = 5;

export interface WarroomCronDeps {
  isPaused: () => Promise<boolean>;
  countAlertsToday: (now: Date) => Promise<number>;
  discoverYoutube: () => Promise<DiscoveryResult>;
  discoverTikTok: () => Promise<DiscoveryResult>;
  discoverInstagram: () => Promise<DiscoveryResult>;
  insertAlert: (params: { post: DiscoveredPost; severity: WarroomSeverity; now: Date }) => Promise<{ inserted: boolean }>;
  pauseForBudget: (reason: string) => Promise<void>;
  getOptedInEmails: () => Promise<string[]>;
  emailClient: EmailClient;
  operatorEmail: string;
}

export interface WarroomCronResult {
  skipped: 'paused' | 'daily_cap' | 'budget_exceeded' | null;
  inserted: number;
}

const SEVERITY_RANK: Record<WarroomSeverity, number> = { already_viral: 3, going_viral: 2, heating_up: 1 };

/**
 * One hourly pass: gate on pause/daily-cap, discover in parallel across
 * all three platforms, score, cap to the top WARROOM_PER_RUN_CAP alerts,
 * insert (relying on the DB's unique constraint for cross-run dedup), and
 * fan out opt-in email for the top two severities. See design spec §4.
 */
export async function runWarroomCron(deps: WarroomCronDeps, now: Date): Promise<WarroomCronResult> {
  if (await deps.isPaused()) {
    return { skipped: 'paused', inserted: 0 };
  }

  const todayCount = await deps.countAlertsToday(now);
  if (todayCount >= WARROOM_DAILY_ALERT_CAP) {
    return { skipped: 'daily_cap', inserted: 0 };
  }

  const settled = await Promise.allSettled([deps.discoverYoutube(), deps.discoverTikTok(), deps.discoverInstagram()]);

  const allErrors: string[] = [];
  const allPosts: DiscoveredPost[] = [];
  for (const result of settled) {
    if (result.status === 'fulfilled') {
      allPosts.push(...result.value.posts);
      allErrors.push(...result.value.errors);
    } else {
      allErrors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
    }
  }

  const budgetError = allErrors.find((e) => BUDGET_EXCEEDED_RE.test(e));
  if (budgetError) {
    await deps.pauseForBudget(budgetError);
    await deps.emailClient.sendEmail({
      to: deps.operatorEmail,
      subject: '🛑 GTA6 War Room Paused — Apify Budget Exhausted',
      html: `<p>The War Room cron paused itself after detecting an Apify budget error:</p><p>${budgetError}</p><p>Reactivate manually once usage resets (design spec §4) — this does not happen automatically.</p>`,
    });
    return { skipped: 'budget_exceeded', inserted: 0 };
  }

  for (const error of allErrors) {
    // Non-budget failures are logged, not paged — not worth an email over one bad scrape.
    console.error('War Room discovery error (non-budget):', error);
  }

  const seenInRun = new Set<string>();
  const candidates: Array<{ post: DiscoveredPost; severity: WarroomSeverity }> = [];
  for (const post of allPosts) {
    const key = `${post.platform}:${post.externalPostId}`;
    if (seenInRun.has(key)) continue;
    seenInRun.add(key);
    const severity = classifySeverity(post, now);
    if (severity) candidates.push({ post, severity });
  }

  candidates.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.post.viewCount - a.post.viewCount);
  const capped = candidates.slice(0, WARROOM_PER_RUN_CAP);

  let insertedCount = 0;
  const newlyInserted: Array<{ post: DiscoveredPost; severity: WarroomSeverity }> = [];
  for (const candidate of capped) {
    const { inserted } = await deps.insertAlert({ post: candidate.post, severity: candidate.severity, now });
    if (inserted) {
      insertedCount += 1;
      newlyInserted.push(candidate);
    }
  }

  const emailWorthy = newlyInserted.filter((c) => c.severity === 'going_viral' || c.severity === 'already_viral');
  if (emailWorthy.length > 0) {
    const recipients = await deps.getOptedInEmails();
    for (const to of recipients) {
      for (const { post, severity } of emailWorthy) {
        await deps.emailClient.sendEmail({
          to,
          subject: `${severity === 'already_viral' ? '💥 Already Viral' : '🚀 Going Viral'} on ${post.platform}`,
          html: `<p>${post.captionOrTitle}</p><p><a href="${post.url}">View post</a></p>`,
        });
      }
    }
  }

  return { skipped: null, inserted: insertedCount };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/warroom/cron-handler.test.ts`
Expected: PASS (all 13 cases)

- [ ] **Step 6: Commit**

```bash
git add lib/warroom/cron-handler.ts tests/fakes/resend.fake.ts tests/unit/lib/warroom/cron-handler.test.ts
git commit -m "feat(warroom): add cron orchestration with budget-pause and opt-in email fan-out"
```

---

### Task 7: `app/api/cron/warroom/route.ts` + `vercel.json`

**Files:**
- Create: `app/api/cron/warroom/route.ts`
- Modify: `vercel.json`

**Interfaces:**
- Consumes: `runWarroomCron`, `WarroomCronDeps` from `lib/warroom/cron-handler.ts` (Task 6); `searchGta6Videos` (Task 3), `searchGta6TikToks` (Task 4), `searchGta6InstagramPosts` (Task 5); `createResendEmailClient` from `lib/integrations/resend.ts` (existing); `createSupabaseServiceRoleClient` from `lib/supabase/server.ts` (existing)
- Produces: `GET /api/cron/warroom` — no other task depends on this route directly (terminal wiring task)

No route unit tests, per this repo's convention (§ Global Constraints) — this task is verified by running the route locally / trusting the already-tested `runWarroomCron` plus a careful read.

- [ ] **Step 1: Write the route**

Create `app/api/cron/warroom/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { createResendEmailClient } from '@/lib/integrations/resend';
import { searchGta6Videos } from '@/lib/warroom/discovery/youtube';
import { searchGta6TikToks } from '@/lib/warroom/discovery/tiktok';
import { searchGta6InstagramPosts } from '@/lib/warroom/discovery/instagram';
import { runWarroomCron } from '@/lib/warroom/cron-handler';
import type { DiscoveredPost, WarroomSeverity } from '@/lib/warroom/types';

// Discovery calls (especially the Apify ones) can each take up to ~90s;
// running all three in parallel keeps total wall-clock bounded by the
// slowest single call rather than their sum. Matches the old weekly-digest
// cron's maxDuration.
export const maxDuration = 300;

function isAuthorizedCronRequest(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return request.headers.get('authorization') === `Bearer ${expected}`;
}

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const serviceClient = createSupabaseServiceRoleClient();
  const emailClient = createResendEmailClient(process.env.RESEND_API_KEY ?? '', process.env.WARROOM_FROM_EMAIL ?? '');
  const apifyToken = process.env.APIFY_API_TOKEN ?? '';
  const youtubeApiKey = process.env.YOUTUBE_API_KEY ?? '';
  const now = new Date();

  const result = await runWarroomCron(
    {
      isPaused: async () => {
        const { data, error } = await serviceClient.from('warroom_settings').select('paused').eq('id', true).single();
        if (error) {
          // Fail loud, not open: this read is the cron's cost-control safety
          // valve. Silently treating a read error as "not paused" would let
          // the job keep calling paid Apify actors during exactly the
          // outage where the pause flag is least trustworthy.
          throw new Error(`Failed to read War Room pause state: ${error.message}`);
        }
        return data?.paused ?? false;
      },
      countAlertsToday: async (asOf) => {
        const startOfDay = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate())).toISOString();
        const { count } = await serviceClient
          .from('warroom_alerts')
          .select('id', { count: 'exact', head: true })
          .gte('detected_at', startOfDay);
        return count ?? 0;
      },
      discoverYoutube: () => searchGta6Videos(youtubeApiKey, new Date(now.getTime() - 60 * 60 * 1000)),
      discoverTikTok: () => searchGta6TikToks(apifyToken),
      discoverInstagram: () => searchGta6InstagramPosts(apifyToken),
      insertAlert: async ({ post, severity, now: insertedAt }: { post: DiscoveredPost; severity: WarroomSeverity; now: Date }) => {
        const { data, error } = await serviceClient
          .from('warroom_alerts')
          .upsert(
            {
              platform: post.platform,
              external_post_id: post.externalPostId,
              url: post.url,
              caption_or_title: post.captionOrTitle,
              view_count: post.viewCount,
              engagement_count: post.engagementCount,
              published_at: post.publishedAt,
              severity,
              detected_at: insertedAt.toISOString(),
            },
            { onConflict: 'platform,external_post_id', ignoreDuplicates: true }
          )
          .select('id');
        if (error) {
          throw new Error(`Failed to insert War Room alert: ${error.message}`);
        }
        return { inserted: (data?.length ?? 0) > 0 };
      },
      pauseForBudget: async (reason) => {
        const { error } = await serviceClient
          .from('warroom_settings')
          .update({ paused: true, paused_reason: reason, paused_at: new Date().toISOString() })
          .eq('id', true);
        if (error) {
          // If this write silently fails, the pause never actually takes
          // effect: next hour's isPaused() still reads false, the cron
          // calls the discovery clients again, hits the same budget error,
          // and re-sends the operator email — every hour, forever. Throw so
          // the failure is visible instead of a quiet no-op.
          throw new Error(`Failed to persist War Room pause: ${error.message}`);
        }
      },
      getOptedInEmails: async () => {
        const { data: profiles } = await serviceClient.from('profiles').select('id').eq('warroom_email_opt_in', true);
        // profiles.email is client-writable and untrustworthy as a mail target
        // (same reasoning as the old weekly-digest cron) — the verified address
        // lives in Supabase Auth, looked up per-candidate via the admin API.
        const emails: string[] = [];
        for (const profile of profiles ?? []) {
          const { data: userData } = await serviceClient.auth.admin.getUserById(profile.id);
          if (userData?.user?.email) emails.push(userData.user.email);
        }
        return emails;
      },
      emailClient,
      operatorEmail: process.env.WARROOM_OPERATOR_EMAIL ?? '',
    },
    now
  );

  return NextResponse.json(result);
}
```

- [ ] **Step 2: Add the cron schedule**

In `vercel.json`, replace the current empty object:
```json
{
  "crons": [{ "path": "/api/cron/warroom", "schedule": "0 * * * *" }]
}
```

- [ ] **Step 3: Type-check and build**

Run: `npx tsc --noEmit`
Expected: no errors

Run: `npm run build`
Expected: succeeds, and `/api/cron/warroom` appears in the route list

- [ ] **Step 4: Commit**

```bash
git add app/api/cron/warroom/route.ts vercel.json
git commit -m "feat(warroom): wire the hourly cron route"
```

---

### Task 8: `lib/warroom/handler.ts` — `handleListWarroomAlerts`

**Files:**
- Create: `lib/warroom/handler.ts`
- Test: `tests/unit/lib/warroom/handler.test.ts`

**Interfaces:**
- Consumes: `WarroomAlertRow` from `lib/warroom/types.ts` (Task 2)
- Produces: `WarroomHandlerDeps` (partial — extended in Task 9), `handleListWarroomAlerts(deps, context): Promise<{status, body}>` — relied on by Task 10 (feed route)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/lib/warroom/handler.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { handleListWarroomAlerts, type WarroomHandlerDeps } from '@/lib/warroom/handler';
import type { WarroomAlertRow } from '@/lib/warroom/types';

function makeDeps(overrides: Partial<WarroomHandlerDeps> = {}): WarroomHandlerDeps {
  return {
    hasActiveSubscription: async () => true,
    getRecentAlerts: async () => [],
    setEmailOptIn: async () => {},
    ...overrides,
  };
}

describe('handleListWarroomAlerts', () => {
  it('rejects a signed-out request', async () => {
    const result = await handleListWarroomAlerts(makeDeps(), { profileId: null });
    expect(result.status).toBe(401);
  });

  it('rejects a signed-in profile with no active subscription', async () => {
    const deps = makeDeps({ hasActiveSubscription: async () => false });
    const result = await handleListWarroomAlerts(deps, { profileId: 'p1' });
    expect(result.status).toBe(402);
    expect(result.body.upgradeUrl).toBe('/billing');
  });

  it('returns the recent alerts for a subscribed profile', async () => {
    const alert: WarroomAlertRow = {
      id: 'a1',
      platform: 'youtube',
      externalPostId: 'v1',
      url: 'https://example.com',
      captionOrTitle: 'GTA 6 news',
      viewCount: 300000,
      engagementCount: 1000,
      publishedAt: '2026-09-15T10:00:00Z',
      severity: 'already_viral',
      detectedAt: '2026-09-15T11:00:00Z',
    };
    const deps = makeDeps({ getRecentAlerts: async () => [alert] });
    const result = await handleListWarroomAlerts(deps, { profileId: 'p1' });
    expect(result.status).toBe(200);
    expect(result.body.alerts).toEqual([alert]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/warroom/handler.test.ts`
Expected: FAIL — `Cannot find module '@/lib/warroom/handler'`

- [ ] **Step 3: Write `lib/warroom/handler.ts`**
```ts
import type { WarroomAlertRow } from './types';

export interface WarroomHandlerDeps {
  hasActiveSubscription: (profileId: string) => Promise<boolean>;
  getRecentAlerts: () => Promise<WarroomAlertRow[]>;
  setEmailOptIn: (profileId: string, optIn: boolean) => Promise<void>;
}

export interface WarroomHandlerResult {
  status: number;
  body: Record<string, unknown>;
}

export async function handleListWarroomAlerts(
  deps: WarroomHandlerDeps,
  context: { profileId: string | null }
): Promise<WarroomHandlerResult> {
  if (!context.profileId) {
    return { status: 401, body: { error: 'You must be signed in to view the War Room.' } };
  }
  if (!(await deps.hasActiveSubscription(context.profileId))) {
    return { status: 402, body: { error: 'GTA6 War Room requires an active subscription.', upgradeUrl: '/billing' } };
  }
  const alerts = await deps.getRecentAlerts();
  return { status: 200, body: { alerts } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/warroom/handler.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/warroom/handler.ts tests/unit/lib/warroom/handler.test.ts
git commit -m "feat(warroom): add handleListWarroomAlerts"
```

---

### Task 9: `lib/warroom/handler.ts` — `handleWarroomOptIn`

**Files:**
- Modify: `lib/warroom/handler.ts`
- Modify: `tests/unit/lib/warroom/handler.test.ts`

**Interfaces:**
- Consumes: `WarroomHandlerDeps` (Task 8, extended here with no new fields — `setEmailOptIn` was already declared in Task 8's interface, just unused until now)
- Produces: `handleWarroomOptIn(deps, context): Promise<{status, body}>` — relied on by Task 10 (opt-in route)

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/lib/warroom/handler.test.ts`:
```ts
import { handleWarroomOptIn } from '@/lib/warroom/handler';

describe('handleWarroomOptIn', () => {
  it('rejects a signed-out request', async () => {
    const result = await handleWarroomOptIn(makeDeps(), { profileId: null, optIn: true });
    expect(result.status).toBe(401);
  });

  it('saves the opt-in value for a signed-in profile', async () => {
    let saved: { profileId: string; optIn: boolean } | null = null;
    const deps = makeDeps({
      setEmailOptIn: async (profileId, optIn) => {
        saved = { profileId, optIn };
      },
    });
    const result = await handleWarroomOptIn(deps, { profileId: 'p1', optIn: true });
    expect(result.status).toBe(200);
    expect(saved).toEqual({ profileId: 'p1', optIn: true });
  });
});
```
(Add the `handleWarroomOptIn` import to the file's existing import line rather than a new one if your editor merges them.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/warroom/handler.test.ts`
Expected: FAIL — `handleWarroomOptIn is not exported`

- [ ] **Step 3: Add `handleWarroomOptIn` to `lib/warroom/handler.ts`**

Append to the file:
```ts
export async function handleWarroomOptIn(
  deps: WarroomHandlerDeps,
  context: { profileId: string | null; optIn: boolean }
): Promise<WarroomHandlerResult> {
  if (!context.profileId) {
    return { status: 401, body: { error: 'You must be signed in to change this setting.' } };
  }
  await deps.setEmailOptIn(context.profileId, context.optIn);
  return { status: 200, body: { ok: true } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/warroom/handler.test.ts`
Expected: PASS (all 5 cases)

- [ ] **Step 5: Commit**

```bash
git add lib/warroom/handler.ts tests/unit/lib/warroom/handler.test.ts
git commit -m "feat(warroom): add handleWarroomOptIn"
```

---

### Task 10: `GET /api/warroom` + `POST /api/warroom/opt-in` routes

**Files:**
- Create: `app/api/warroom/route.ts`
- Create: `app/api/warroom/opt-in/route.ts`

**Interfaces:**
- Consumes: `handleListWarroomAlerts`, `handleWarroomOptIn` from `lib/warroom/handler.ts` (Tasks 8-9); `hasActiveSubscription` from `lib/billing/entitlements.ts` (existing); `createSupabaseServerClient`/`createSupabaseServiceRoleClient` from `lib/supabase/server.ts` (existing)
- Produces: `GET /api/warroom`, `POST /api/warroom/opt-in` — relied on by Task 12 (page)

No route unit tests, per this repo's convention.

- [ ] **Step 1: Write `app/api/warroom/route.ts`**
```ts
import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { hasActiveSubscription } from '@/lib/billing/entitlements';
import { handleListWarroomAlerts } from '@/lib/warroom/handler';
import type { WarroomAlertRow } from '@/lib/warroom/types';

function mapAlertRow(row: {
  id: string;
  platform: string;
  external_post_id: string;
  url: string;
  caption_or_title: string;
  view_count: number;
  engagement_count: number;
  published_at: string;
  severity: string;
  detected_at: string;
}): WarroomAlertRow {
  return {
    id: row.id,
    platform: row.platform as WarroomAlertRow['platform'],
    externalPostId: row.external_post_id,
    url: row.url,
    captionOrTitle: row.caption_or_title,
    viewCount: row.view_count,
    engagementCount: row.engagement_count,
    publishedAt: row.published_at,
    severity: row.severity as WarroomAlertRow['severity'],
    detectedAt: row.detected_at,
  };
}

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const serviceClient = createSupabaseServiceRoleClient();

  const result = await handleListWarroomAlerts(
    {
      hasActiveSubscription: (profileId) => hasActiveSubscription(serviceClient, profileId),
      getRecentAlerts: async () => {
        const { data } = await serviceClient
          .from('warroom_alerts')
          .select('*')
          .order('detected_at', { ascending: false })
          .limit(100);
        return (data ?? []).map(mapAlertRow);
      },
      setEmailOptIn: async () => {}, // unused on this route
    },
    { profileId: user?.id ?? null }
  );

  return NextResponse.json(result.body, { status: result.status });
}
```

- [ ] **Step 2: Write `app/api/warroom/opt-in/route.ts`**
```ts
import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { handleWarroomOptIn } from '@/lib/warroom/handler';

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const serviceClient = createSupabaseServiceRoleClient();
  const body = await request.json().catch(() => ({}));

  const result = await handleWarroomOptIn(
    {
      hasActiveSubscription: async () => true, // unused on this route
      getRecentAlerts: async () => [], // unused on this route
      setEmailOptIn: async (profileId, optIn) => {
        await serviceClient.from('profiles').update({ warroom_email_opt_in: optIn }).eq('id', profileId);
      },
    },
    { profileId: user?.id ?? null, optIn: Boolean(body.optIn) }
  );

  return NextResponse.json(result.body, { status: result.status });
}
```

- [ ] **Step 3: Type-check and build**

Run: `npx tsc --noEmit`
Expected: no errors

Run: `npm run build`
Expected: succeeds, `/api/warroom` and `/api/warroom/opt-in` appear in the route list

- [ ] **Step 4: Commit**

```bash
git add app/api/warroom/route.ts app/api/warroom/opt-in/route.ts
git commit -m "feat(warroom): wire the feed and opt-in routes"
```

---

### Task 11: `lib/warroom/page-state.ts`

**Files:**
- Create: `lib/warroom/page-state.ts`
- Test: `tests/unit/lib/warroom/page-state.test.ts`

**Interfaces:**
- Consumes: `WarroomAlertRow` from `lib/warroom/types.ts` (Task 2); `isValidEmailFormat` from `lib/auth/sign-in-flow-state.ts` (existing, same import `lib/ideas/page-state.ts` already uses)
- Produces: `WarroomPageState`, `WarroomPageEvent`, `createInitialWarroomPageState()`, `warroomPageReducer(state, event)` — relied on by Task 12 (page)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/lib/warroom/page-state.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { warroomPageReducer, createInitialWarroomPageState, type WarroomPageState } from '@/lib/warroom/page-state';
import type { WarroomAlertRow } from '@/lib/warroom/types';

const ALERT: WarroomAlertRow = {
  id: 'a1',
  platform: 'youtube',
  externalPostId: 'v1',
  url: 'https://example.com',
  captionOrTitle: 'GTA 6 news',
  viewCount: 300000,
  engagementCount: 1000,
  publishedAt: '2026-09-15T10:00:00Z',
  severity: 'already_viral',
  detectedAt: '2026-09-15T11:00:00Z',
};

describe('createInitialWarroomPageState', () => {
  it('starts in loading', () => {
    expect(createInitialWarroomPageState()).toEqual({ status: 'loading' });
  });
});

describe('warroomPageReducer', () => {
  it('moves to needsSignIn on BOOTSTRAP_UNAUTHORIZED', () => {
    expect(warroomPageReducer({ status: 'loading' }, { type: 'BOOTSTRAP_UNAUTHORIZED' })).toEqual({
      status: 'needsSignIn',
      email: '',
      notice: null,
    });
  });

  it('moves to requiresUpgrade on BOOTSTRAP_PAYMENT_REQUIRED', () => {
    expect(warroomPageReducer({ status: 'loading' }, { type: 'BOOTSTRAP_PAYMENT_REQUIRED' })).toEqual({
      status: 'requiresUpgrade',
    });
  });

  it('moves to bootstrapFailed on BOOTSTRAP_FAILED', () => {
    expect(warroomPageReducer({ status: 'loading' }, { type: 'BOOTSTRAP_FAILED' })).toEqual({ status: 'bootstrapFailed' });
  });

  it('moves to loaded on BOOTSTRAPPED, carrying the alerts and opt-in value', () => {
    const next = warroomPageReducer(
      { status: 'loading' },
      { type: 'BOOTSTRAPPED', alerts: [ALERT], emailOptIn: true }
    );
    expect(next).toEqual({ status: 'loaded', alerts: [ALERT], emailOptIn: true, optInError: null });
  });

  it('optimistically updates emailOptIn and clears any prior error on OPT_IN_TOGGLED', () => {
    const state: WarroomPageState = { status: 'loaded', alerts: [ALERT], emailOptIn: false, optInError: 'old error' };
    expect(warroomPageReducer(state, { type: 'OPT_IN_TOGGLED', optIn: true })).toEqual({
      status: 'loaded',
      alerts: [ALERT],
      emailOptIn: true,
      optInError: null,
    });
  });

  it('reverts to the previous value and sets an error on OPT_IN_SAVE_FAILED', () => {
    const state: WarroomPageState = { status: 'loaded', alerts: [ALERT], emailOptIn: true, optInError: null };
    expect(warroomPageReducer(state, { type: 'OPT_IN_SAVE_FAILED', previousValue: false, error: 'boom' })).toEqual({
      status: 'loaded',
      alerts: [ALERT],
      emailOptIn: false,
      optInError: 'boom',
    });
  });

  it('ignores OPT_IN_TOGGLED while loading (impossible-state guard)', () => {
    const state: WarroomPageState = { status: 'loading' };
    expect(warroomPageReducer(state, { type: 'OPT_IN_TOGGLED', optIn: true })).toBe(state);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/warroom/page-state.test.ts`
Expected: FAIL — `Cannot find module '@/lib/warroom/page-state'`

- [ ] **Step 3: Write `lib/warroom/page-state.ts`**

Mirrors `lib/ideas/page-state.ts`'s sign-in sub-flow exactly (this page needs the identical needsSignIn/submittingMagicLink/checkEmail/magicLinkError states), plus its own `loaded` shape:
```ts
import { isValidEmailFormat } from '@/lib/auth/sign-in-flow-state';
import type { WarroomAlertRow } from './types';

export type WarroomPageState =
  | { status: 'loading' }
  | { status: 'bootstrapFailed' }
  | { status: 'requiresUpgrade' }
  | { status: 'loaded'; alerts: WarroomAlertRow[]; emailOptIn: boolean; optInError: string | null }
  | { status: 'needsSignIn'; email: string; notice: string | null }
  | { status: 'submittingMagicLink'; email: string }
  | { status: 'checkEmail'; email: string }
  | { status: 'magicLinkError'; email: string; error: string };

export type WarroomPageEvent =
  | { type: 'BOOTSTRAPPED'; alerts: WarroomAlertRow[]; emailOptIn: boolean }
  | { type: 'BOOTSTRAP_FAILED' }
  | { type: 'BOOTSTRAP_UNAUTHORIZED' }
  | { type: 'BOOTSTRAP_PAYMENT_REQUIRED' }
  | { type: 'OPT_IN_TOGGLED'; optIn: boolean }
  | { type: 'OPT_IN_SAVE_FAILED'; previousValue: boolean; error: string }
  | { type: 'EMAIL_CHANGED'; email: string }
  | { type: 'SUBMIT_EMAIL' }
  | { type: 'MAGIC_LINK_SENT' }
  | { type: 'MAGIC_LINK_FAILED'; error: string }
  | { type: 'RESEND_EMAIL' }
  | { type: 'RETRY_EMAIL' };

export function createInitialWarroomPageState(): WarroomPageState {
  return { status: 'loading' };
}

export function warroomPageReducer(state: WarroomPageState, event: WarroomPageEvent): WarroomPageState {
  switch (event.type) {
    case 'BOOTSTRAPPED':
      return { status: 'loaded', alerts: event.alerts, emailOptIn: event.emailOptIn, optInError: null };

    case 'BOOTSTRAP_FAILED':
      return { status: 'bootstrapFailed' };

    case 'BOOTSTRAP_UNAUTHORIZED':
      return { status: 'needsSignIn', email: '', notice: null };

    case 'BOOTSTRAP_PAYMENT_REQUIRED':
      return { status: 'requiresUpgrade' };

    case 'OPT_IN_TOGGLED':
      return state.status === 'loaded' ? { ...state, emailOptIn: event.optIn, optInError: null } : state;

    case 'OPT_IN_SAVE_FAILED':
      return state.status === 'loaded' ? { ...state, emailOptIn: event.previousValue, optInError: event.error } : state;

    case 'EMAIL_CHANGED':
      return state.status === 'needsSignIn' || state.status === 'magicLinkError' ? { ...state, email: event.email } : state;

    case 'SUBMIT_EMAIL':
      if (state.status !== 'needsSignIn' && state.status !== 'magicLinkError') return state;
      if (!isValidEmailFormat(state.email)) return state;
      return { status: 'submittingMagicLink', email: state.email };

    case 'MAGIC_LINK_SENT':
      return state.status === 'submittingMagicLink' ? { status: 'checkEmail', email: state.email } : state;

    case 'MAGIC_LINK_FAILED':
      return state.status === 'submittingMagicLink' ? { status: 'magicLinkError', email: state.email, error: event.error } : state;

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

Run: `npx vitest run tests/unit/lib/warroom/page-state.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/warroom/page-state.ts tests/unit/lib/warroom/page-state.test.ts
git commit -m "feat(warroom): add the page state machine"
```

---

### Task 12: `app/warroom/page.tsx`

**Files:**
- Create: `app/warroom/page.tsx`
- Test: `tests/unit/app/warroom/page.test.tsx`

**Interfaces:**
- Consumes: `warroomPageReducer`, `createInitialWarroomPageState` from `lib/warroom/page-state.ts` (Task 11); `AppNav`, `Spinner`, `SignInPrompt`, `UpgradePrompt` components (existing, same imports `app/ideas/page.tsx` uses)
- Produces: the `/warroom` page — relied on by Task 13 (nav link) and Task 15 (E2E)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/app/warroom/page.test.tsx`:
```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/components/AppNav', () => ({ AppNav: () => null }));

import WarroomPage from '@/app/warroom/page';

function alertsResponse(overrides: Record<string, unknown> = {}) {
  return {
    alerts: [
      {
        id: 'a1',
        platform: 'youtube',
        externalPostId: 'v1',
        url: 'https://example.com/v1',
        captionOrTitle: 'GTA 6 trailer breakdown',
        viewCount: 300000,
        engagementCount: 1000,
        publishedAt: '2026-09-15T10:00:00Z',
        severity: 'already_viral',
        detectedAt: '2026-09-15T11:00:00Z',
      },
    ],
    emailOptIn: false,
    ...overrides,
  };
}

describe('WarroomPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the sign-in prompt when the bootstrap fetch is unauthorized', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'unauthorized' }) }));
    render(<WarroomPage />);
    await waitFor(() => expect(screen.getByLabelText('Email')).toBeInTheDocument());
  });

  it('shows the upgrade prompt when the bootstrap fetch requires payment', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 402, json: async () => ({ error: 'payment required', upgradeUrl: '/billing' }) }));
    render(<WarroomPage />);
    // The page's 402 branch renders a static <UpgradePrompt>, not the fetched
    // error body (same pattern as /ideas and /strategy) — assert against
    // that component's own title text, not the discarded API error string.
    await waitFor(() => expect(screen.getByText(/is part of creator dashboard's paid plan/i)).toBeInTheDocument());
  });

  it('renders each alert with its severity and platform', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => alertsResponse() }));
    render(<WarroomPage />);
    await waitFor(() => expect(screen.getByText('GTA 6 trailer breakdown')).toBeInTheDocument());
    expect(screen.getByText(/already viral/i)).toBeInTheDocument();
  });

  it('shows the empty state when there are no alerts yet', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => alertsResponse({ alerts: [] }) }));
    render(<WarroomPage />);
    await waitFor(() => expect(screen.getByText(/no gta 6 alerts yet/i)).toBeInTheDocument());
  });

  it('builds a "Generate an idea from this" link carrying the alert caption as context', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => alertsResponse() }));
    render(<WarroomPage />);
    await waitFor(() => expect(screen.getByRole('link', { name: /generate an idea from this/i })).toBeInTheDocument());
    const link = screen.getByRole('link', { name: /generate an idea from this/i });
    expect(link).toHaveAttribute('href', `/ideas?context=${encodeURIComponent('GTA 6 trailer breakdown')}`);
  });

  it('toggles the email opt-in checkbox via POST /api/warroom/opt-in', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => alertsResponse() })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<WarroomPage />);
    const checkbox = await screen.findByRole('checkbox', { name: /email me when something crosses going viral/i });
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);

    expect(checkbox).toBeChecked();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/warroom/opt-in',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ optIn: true }) })
      )
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/app/warroom/page.test.tsx`
Expected: FAIL — `Cannot find module '@/app/warroom/page'`

- [ ] **Step 3: Write `app/warroom/page.tsx`**
```tsx
'use client';

import { useEffect, useReducer } from 'react';
import { AppNav } from '@/components/AppNav';
import { SignInPrompt } from '@/components/SignInPrompt';
import { UpgradePrompt } from '@/components/UpgradePrompt';
import { warroomPageReducer, createInitialWarroomPageState } from '@/lib/warroom/page-state';
import type { WarroomAlertRow } from '@/lib/warroom/types';

const SEVERITY_LABELS: Record<WarroomAlertRow['severity'], string> = {
  heating_up: '🔥 Heating Up',
  going_viral: '🚀 Going Viral',
  already_viral: '💥 Already Viral',
};

export default function WarroomPage() {
  const [state, dispatch] = useReducer(warroomPageReducer, createInitialWarroomPageState());

  useEffect(() => {
    let cancelled = false;
    fetch('/api/warroom')
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401) {
          dispatch({ type: 'BOOTSTRAP_UNAUTHORIZED' });
          return;
        }
        if (res.status === 402) {
          dispatch({ type: 'BOOTSTRAP_PAYMENT_REQUIRED' });
          return;
        }
        const data = await res.json();
        if (data.error) {
          dispatch({ type: 'BOOTSTRAP_FAILED' });
          return;
        }
        dispatch({ type: 'BOOTSTRAPPED', alerts: data.alerts ?? [], emailOptIn: data.emailOptIn ?? false });
      })
      .catch(() => {
        if (!cancelled) dispatch({ type: 'BOOTSTRAP_FAILED' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function submitMagicLink(email: string) {
    try {
      const response = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, redirectPath: '/warroom' }),
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

  async function toggleOptIn(optIn: boolean) {
    if (state.status !== 'loaded') return;
    const previousValue = state.emailOptIn;
    dispatch({ type: 'OPT_IN_TOGGLED', optIn });
    try {
      const res = await fetch('/api/warroom/opt-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ optIn }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        dispatch({ type: 'OPT_IN_SAVE_FAILED', previousValue, error: data.error ?? 'Something went wrong saving that.' });
      }
    } catch {
      dispatch({
        type: 'OPT_IN_SAVE_FAILED',
        previousValue,
        error: "We couldn't reach the server. Check your connection and try again.",
      });
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
        <h1 className="text-2xl font-bold text-gray-900">GTA 6 War Room</h1>
        <SignInPrompt
          state={state}
          introCopy="Sign in with a one-time email link to see what's trending in GTA 6 right now."
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

  if (state.status === 'requiresUpgrade') {
    return (
      <>
        <AppNav />
        <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
          <h1 className="text-2xl font-bold text-gray-900">GTA 6 War Room</h1>
          <UpgradePrompt
            title="GTA 6 War Room is part of Creator Dashboard's paid plan"
            body="See what's trending in GTA 6 right now, across YouTube, TikTok, and Instagram, for $10/mo."
          />
        </main>
      </>
    );
  }

  if (state.status === 'bootstrapFailed') {
    return (
      <>
        <AppNav />
        <p role="alert">We couldn&apos;t load the War Room. Please refresh and try again.</p>
      </>
    );
  }

  return (
    <>
      <AppNav />
      <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
        <h1 className="text-2xl font-bold text-gray-900">GTA 6 War Room</h1>
        <p className="text-gray-600">What&apos;s trending in GTA 6 right now, across YouTube, TikTok, and Instagram.</p>

        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={state.emailOptIn}
            onChange={(e) => toggleOptIn(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300"
          />
          Email me when something crosses Going Viral
        </label>
        {state.optInError && (
          <p role="alert" className="text-sm text-red-600">
            {state.optInError}
          </p>
        )}

        {state.alerts.length === 0 ? (
          <p className="text-gray-500">No GTA 6 alerts yet — check back soon.</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {state.alerts.map((alert) => (
              <li key={alert.id} className="rounded-lg border border-gray-200 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{SEVERITY_LABELS[alert.severity]}</span>
                  <span className="text-xs uppercase text-gray-400">{alert.platform}</span>
                </div>
                <p className="mt-1 text-gray-900">{alert.captionOrTitle}</p>
                <p className="mt-1 text-xs text-gray-500">
                  {alert.viewCount.toLocaleString()} views · {alert.engagementCount.toLocaleString()} engagement
                </p>
                <div className="mt-2 flex gap-4 text-sm">
                  <a href={alert.url} target="_blank" rel="noreferrer" className="text-indigo-700 underline">
                    View post
                  </a>
                  <a href={`/ideas?context=${encodeURIComponent(alert.captionOrTitle)}`} className="text-indigo-700 underline">
                    Generate an idea from this
                  </a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/app/warroom/page.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/warroom/page.tsx tests/unit/app/warroom/page.test.tsx
git commit -m "feat(warroom): add the /warroom feed page"
```

---

### Task 13: Landing page + `AppNav` link

**Files:**
- Modify: `app/page.tsx`
- Modify: `components/AppNav.tsx`
- Modify: `tests/unit/app/page-content.test.tsx`
- Modify: `tests/unit/components/AppNav.test.tsx`

**Interfaces:**
- Consumes: nothing new
- Produces: nothing consumed by later tasks — this is the visible entry point into Task 12's page

- [ ] **Step 1: Write the failing tests**

In `tests/unit/app/page-content.test.tsx`, add:
```ts
  it('links to the GTA 6 War Room', async () => {
    await renderSignedOut();
    expect(screen.getByRole('link', { name: /see what's trending in gta 6 right now/i })).toHaveAttribute('href', '/warroom');
  });
```

In `tests/unit/components/AppNav.test.tsx`, add:
```ts
  it('includes a War Room link right after Home', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ email: 'jordan@example.com' }) }));
    render(<AppNav />);
    const links = await screen.findAllByRole('link');
    const labels = links.map((l) => l.textContent);
    const homeIndex = labels.indexOf('Home');
    expect(labels[homeIndex + 1]).toBe('War Room');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/app/page-content.test.tsx tests/unit/components/AppNav.test.tsx`
Expected: FAIL — no "War Room" link found in either file

- [ ] **Step 3: Add the nav link**

In `components/AppNav.tsx`, update `NAV_LINKS`:
```ts
const NAV_LINKS = [
  { href: '/home', label: 'Home' },
  { href: '/warroom', label: 'War Room' },
  { href: '/recap', label: 'Recap' },
  { href: '/ideas', label: 'Ideas' },
  { href: '/strategy', label: 'Strategy' },
  { href: '/watchlist', label: 'Watchlist' },
  { href: '/billing', label: 'Billing' },
] as const;
```

- [ ] **Step 4: Add the landing page link**

In `app/page.tsx`, add a link right after the primary CTA (before the existing `/recap` link):
```tsx
      <Link href="/warroom" className="text-indigo-700 underline">
        See what&apos;s trending in GTA 6 right now
      </Link>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/app/page-content.test.tsx tests/unit/components/AppNav.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/page.tsx components/AppNav.tsx tests/unit/app/page-content.test.tsx tests/unit/components/AppNav.test.tsx
git commit -m "feat(warroom): add nav and landing page links"
```

---

### Task 14: Content Ideas context link

**Files:**
- Modify: `lib/ideas/handler.ts`
- Modify: `app/ideas/page.tsx`
- Modify: `tests/unit/lib/ideas/handler.test.ts`

**Interfaces:**
- Consumes: nothing new
- Produces: an optional `context` field on `handleIdeasRequest`'s POST body, threaded into the Claude prompt call

- [ ] **Step 1: Write the failing test**

In `tests/unit/lib/ideas/handler.test.ts`, find the test that asserts what gets passed to `contentIdeasClient.generateContentIdeas` (or add a new one near the existing generation tests) and add:
```ts
  it('threads an optional context string through to the content ideas client when provided', async () => {
    let capturedContext: string | undefined;
    const deps = makeDeps({
      contentIdeasClient: {
        generateContentIdeas: async (niche, _date, context) => {
          capturedContext = context;
          return [];
        },
      },
    });
    await handleIdeasRequest(deps, { profileId: 'p1', ip: '203.0.113.1', now: NOW, context: 'GTA 6 trailer breakdown' });
    expect(capturedContext).toBe('GTA 6 trailer breakdown');
  });
```
(Match this to however the existing test file's `makeDeps`/`NOW` helpers are named — reuse them, don't redefine.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/ideas/handler.test.ts`
Expected: FAIL — either a type error (no `context` field on the request) or `capturedContext` is `undefined` when a 3rd arg was expected

- [ ] **Step 3: Thread the field through `lib/ideas/handler.ts`**

In `lib/ideas/handler.ts`, change the `IdeasRequestContext` interface:
```ts
export interface IdeasRequestContext {
  profileId: string | null;
  ip: string;
  now: Date;
  context?: string;
}
```
And change the generation call inside `handleIdeasRequest`:
```ts
    const ideas = await deps.contentIdeasClient.generateContentIdeas(niche, context.now, context.context);
```
(replacing the existing `const ideas = await deps.contentIdeasClient.generateContentIdeas(niche, context.now);` line).

In `lib/integrations/claude-ideas.ts`, change the `ContentIdeasClient` interface:
```ts
export interface ContentIdeasClient {
  generateContentIdeas(niche: string, currentDate: Date, extraContext?: string): Promise<ContentIdea[]>;
}
```
And in `createClaudeContentIdeasClient`'s returned object, change `generateContentIdeas`'s signature and body to build the user message conditionally:
```ts
    async generateContentIdeas(niche: string, currentDate: Date, extraContext?: string): Promise<ContentIdea[]> {
      const safeNiche = escapeForContainmentTag(niche);
      const contextLine = extraContext
        ? `\nAlso factor in this specific moment the creator wants to start from: <context>${escapeForContainmentTag(extraContext)}</context>`
        : '';
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 8192,
          system: CONTENT_IDEAS_SYSTEM_PROMPT,
          tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 8 }],
          messages: [
            {
              role: 'user',
              content: `GTA6 focus: <niche>${safeNiche}</niche>\nToday's date: ${currentDate.toISOString().slice(0, 10)}${contextLine}\n\nGenerate this week's content ideas.`,
            },
          ],
        }),
      });
```
(This replaces the existing `generateContentIdeas` implementation's opening lines up through the `fetch` call's `body` — everything from `if (!response.ok)` onward in that function is unchanged.)

In `app/api/ideas/route.ts`, change the `POST` handler to parse the request body for an optional `context` field and pass it through:
```ts
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
    const body = await request.json().catch(() => ({}));
```
(add the `body` line right after the existing `ip` assignment), and change the final call's context argument from:
```ts
      { profileId: user?.id ?? null, ip, now: new Date() }
```
to:
```ts
      { profileId: user?.id ?? null, ip, now: new Date(), context: typeof body.context === 'string' ? body.context : undefined }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/ideas/handler.test.ts`
Expected: PASS (this test plus every pre-existing case in the file)

- [ ] **Step 5: Read the query param on `/ideas` and thread it into the generate call**

In `app/ideas/page.tsx`, add a new import line right after the existing `'use client';` line's imports (below `import { useEffect, useReducer, useRef } from 'react';`):
```tsx
import { useSearchParams } from 'next/navigation';
```
Inside `IdeasPage`, right after the existing `const [state, dispatch] = useReducer(ideasPageReducer, createInitialIdeasPageState());` line, add:
```tsx
  const searchParams = useSearchParams();
  const warroomContext = searchParams.get('context');
```
Change the `generate` function's POST call from:
```tsx
      const res = await fetch('/api/ideas', { method: 'POST' });
```
to:
```tsx
      const res = warroomContext
        ? await fetch('/api/ideas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ context: warroomContext }),
          })
        : await fetch('/api/ideas', { method: 'POST' });
```
Keeping the plain `{ method: 'POST' }` call for the no-context case (rather than always sending `headers`/`body`) matters: an existing test in `tests/unit/app/ideas/page.test.tsx` (`'shows the generate button once a niche is set...'`) asserts `expect(fetchMock).toHaveBeenLastCalledWith('/api/ideas', { method: 'POST' })` exactly — always adding a body would break that pre-existing, still-valid test. (The rest of `generate`'s body — reading `res.json()`, dispatching `GENERATE_SUCCESS`/`GENERATE_FAILED` — is unchanged.)

- [ ] **Step 6: Write a test proving the query param prefills into the generate call**

In `tests/unit/app/ideas/page.test.tsx`, change the file's existing `next/navigation` mock from:
```ts
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
```
to:
```ts
const { useSearchParamsMock } = vi.hoisted(() => ({
  useSearchParamsMock: vi.fn(() => new URLSearchParams()),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: useSearchParamsMock,
}));
```
And change the file's existing `afterEach` block from:
```ts
  afterEach(() => {
    vi.unstubAllGlobals();
  });
```
to:
```ts
  afterEach(() => {
    vi.unstubAllGlobals();
    useSearchParamsMock.mockReturnValue(new URLSearchParams());
  });
```
Then add a new test:
```tsx
  it('threads a ?context= query param into the generate request', async () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams('context=GTA+6+trailer+breakdown'));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ niche: 'home baking', digest: null }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ digest: { id: 'd1', weekStart: '2026-08-10', contentIdeas: [] } }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<IdeasPage />);
    await waitFor(() => screen.getByRole('button', { name: /get this week's ideas/i }));
    fireEvent.click(screen.getByRole('button', { name: /get this week's ideas/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/ideas',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ context: 'GTA 6 trailer breakdown' }) })
      )
    );
  });
```

- [ ] **Step 7: Run all touched test files and verify green**

Run: `npx vitest run tests/unit/lib/ideas/handler.test.ts tests/unit/lib/integrations tests/unit/app/ideas/page.test.tsx`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add lib/ideas/handler.ts lib/integrations/claude-ideas.ts app/ideas/page.tsx app/api/ideas/route.ts tests/unit/lib/ideas/handler.test.ts tests/unit/app/ideas/page.test.tsx
git commit -m "feat(warroom): thread an optional War Room alert context into Content Ideas generation"
```

---

### Task 15: Playwright E2E smoke test

**Files:**
- Create: `tests/e2e/warroom-smoke.spec.ts`

**Interfaces:**
- Consumes: the full `/warroom` page (Task 12) and `/ideas` page (Task 14)
- Produces: nothing — terminal task

- [ ] **Step 1: Write the E2E spec**

Create `tests/e2e/warroom-smoke.spec.ts`:
```ts
import { test, expect } from '@playwright/test';

test('a subscribed user sees a War Room alert and follows it into a pre-filled Content Ideas generation', async ({ page }) => {
  await page.route('**/api/warroom', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          alerts: [
            {
              id: 'a1',
              platform: 'youtube',
              externalPostId: 'v1',
              url: 'https://example.com/v1',
              captionOrTitle: 'GTA 6 trailer breakdown',
              viewCount: 300000,
              engagementCount: 1000,
              publishedAt: '2026-09-15T10:00:00Z',
              severity: 'already_viral',
              detectedAt: '2026-09-15T11:00:00Z',
            },
          ],
          emailOptIn: false,
        }),
      });
    }
  });

  await page.route('**/api/ideas', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ niche: 'GTA RP', digest: null }) });
      return;
    }
    await route.continue();
  });

  await page.goto('/warroom');

  await expect(page.getByText('GTA 6 trailer breakdown')).toBeVisible();
  await expect(page.getByText(/already viral/i)).toBeVisible();

  await page.getByRole('link', { name: /generate an idea from this/i }).click();

  await expect(page).toHaveURL(/\/ideas\?context=/);
  await expect(page.getByRole('heading', { name: 'Weekly content ideas' })).toBeVisible();
});
```

- [ ] **Step 2: Run the E2E spec**

Run: `npx playwright test tests/e2e/warroom-smoke.spec.ts --project=chromium`
Expected: PASS

- [ ] **Step 3: Run the full verification suite**

Run: `npx vitest run`
Expected: every test file passes, including all pre-existing ones

Run: `npx tsc --noEmit`
Expected: no errors

Run: `npm run build`
Expected: succeeds; `/warroom`, `/api/warroom`, `/api/warroom/opt-in`, and `/api/cron/warroom` all appear in the route list

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/warroom-smoke.spec.ts
git commit -m "test(warroom): add end-to-end smoke test"
```
