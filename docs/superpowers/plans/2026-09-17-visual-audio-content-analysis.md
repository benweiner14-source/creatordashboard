# Visual & Audio Content Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in, paid, second-pass diagnostic that downloads a TikTok video, extracts real frames from its first 5 seconds, and has Claude produce a qualitative narrative about whether the hook actually works visually — surfaced via a new endpoint and a button on the existing report page.

**Architecture:** A new `POST /api/diagnostic/[id]/enrich` endpoint, entirely separate from the existing fast diagnostic path, following the same injected-dependencies handler pattern already used by `lib/diagnostic/handler.ts` and `lib/ideas/handler.ts`. Three new integration clients (video acquisition on `ScraperClient`, a frame-extraction client, and a Claude vision client) are composed by a new `lib/diagnostic/enrich-handler.ts`, which is gated by ownership, an active subscription, and platform support (TikTok only for this build) before ever calling a paid third-party API. Results persist to three new nullable columns on `diagnostics`.

**Tech Stack:** TypeScript, Next.js API routes, Supabase (Postgres + migrations), Apify (`clockworks/tiktok-scraper` video download, `automation-lab/video-thumbnail-frame-extractor`), Anthropic Claude API (vision), Vitest, React Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-17-visual-audio-content-analysis-design.md`

## Global Constraints

- Real first-5-seconds multi-frame extraction only — never a thumbnail-only shortcut. Sample every 0.5s from 0s to 4.5s (10 timestamps): `[0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5]`.
- TikTok only for this build. Instagram and YouTube are out of scope — reject them with a clear "not available yet" response, never a generic 500, and never let either enter the `pending`/`failed` DB lifecycle.
- Output is a qualitative narrative string only. No new numeric score, no change to `combineScores` or `overall_score`.
- Gated behind an active subscription via the existing `hasActiveSubscription` helper (`lib/billing/entitlements.ts`) — exact 402 + `upgradeUrl: '/billing'` pattern already used by `lib/ideas/handler.ts`.
- `maxDuration = 60` on the new route — this Vercel project is confirmed on the Hobby plan, whose real function-duration ceiling is 60 seconds regardless of what any route declares.
- No retry-with-backoff inside the enrichment request itself — a slow/failed step surfaces as a clear error, never a silent extra attempt that risks the 60s budget.
- Apify actor input quirks, confirmed empirically and must be preserved exactly: `videoUrls` is an array of `{ url }` objects, not plain strings; `outputFormat` must be lowercase (`"jpeg"`, not `"JPEG"`).
- Never fail the base diagnostic over anything in this feature — this is entirely additive, reached only through its own new endpoint.

---

### Task 1: Database migration and types for visual/audio columns

**Files:**
- Create: `supabase/migrations/20260917000002_add_visual_audio_columns_to_diagnostics.sql`
- Modify: `lib/supabase/types.ts`
- Test: `tests/unit/supabase/migrations.test.ts`

**Interfaces:**
- Produces: three nullable columns on `public.diagnostics` (`visual_audio_status`, `visual_audio_narrative`, `visual_audio_error`) and matching `Row`/`Insert` fields in `Database['public']['Tables']['diagnostics']`, consumed by Task 7's `saveEnrichment`/`getDiagnostic` and Task 8's frontend fetch.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/supabase/migrations.test.ts` (follow the existing `readMigrationContaining` pattern already in this file):

```ts
it('includes a migration adding visual/audio columns to diagnostics', () => {
  const sql = readMigrationContaining('add_visual_audio_columns');
  expect(sql).toContain('alter table public.diagnostics');
  expect(sql).toContain("visual_audio_status text check (visual_audio_status in ('pending', 'complete', 'failed'))");
  expect(sql).toContain('visual_audio_narrative text');
  expect(sql).toContain('visual_audio_error text');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/supabase/migrations.test.ts`
Expected: FAIL with `No migration file matching "add_visual_audio_columns"`

- [ ] **Step 3: Write the migration**

```sql
alter table public.diagnostics
  add column visual_audio_status text check (visual_audio_status in ('pending', 'complete', 'failed')),
  add column visual_audio_narrative text,
  add column visual_audio_error text;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/supabase/migrations.test.ts`
Expected: PASS

- [ ] **Step 5: Update `lib/supabase/types.ts` in the same change**

In `Database['public']['Tables']['diagnostics']`, add to both `Row` and `Insert` (this was a gap the Reach dimension's plan discovered late via `tsc` — fold it in now instead):

```ts
// Row (all required, nullable):
visual_audio_status: 'pending' | 'complete' | 'failed' | null;
visual_audio_narrative: string | null;
visual_audio_error: string | null;
```

```ts
// Insert (all optional):
visual_audio_status?: 'pending' | 'complete' | 'failed' | null;
visual_audio_narrative?: string | null;
visual_audio_error?: string | null;
```

(`Update` is already `Partial<Insert>` for this table — no separate change needed there.)

Run: `npx tsc --noEmit`
Expected: PASS (no existing code references these fields yet, so this should be a no-op typecheck-wise)

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260917000002_add_visual_audio_columns_to_diagnostics.sql lib/supabase/types.ts tests/unit/supabase/migrations.test.ts
git commit -m "feat(diagnostic): add visual/audio analysis columns to diagnostics"
```

---

### Task 2: Claude image content block support

**Files:**
- Modify: `lib/integrations/claude-shared.ts`
- Test: `tests/unit/lib/integrations/claude-shared.test.ts`

**Interfaces:**
- Produces: a new `ClaudeContentBlock` variant `{ type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg'; data: string } }`, consumed by Task 5 (`claude-visual-audio.ts`).

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/lib/integrations/claude-shared.test.ts`, inside the `describe('requestClaudeJson', ...)` block (follow the existing PDF-document-block test in this file as the pattern to match):

```ts
it('accepts a content-block array with an image block and forwards it verbatim', async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ content: [{ text: '{"ok":true}' }] }),
  });
  vi.stubGlobal('fetch', fetchMock);

  const blocks = [
    { type: 'text' as const, text: 'Look at this frame.' },
    { type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: 'ZmFrZS1qcGVn' } },
  ];

  const result = await requestClaudeJson<{ ok: boolean }>({
    apiKey: 'key',
    model: 'claude-sonnet-5',
    maxTokens: 100,
    system: 'sys',
    userContent: blocks,
  });

  expect(result).toEqual({ ok: true });
  const [, options] = fetchMock.mock.calls[0];
  const body = JSON.parse(options.body as string);
  expect(body.messages[0].content).toEqual(blocks);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/integrations/claude-shared.test.ts`
Expected: FAIL — TypeScript error, `type: 'image'` is not assignable to `ClaudeContentBlock`

- [ ] **Step 3: Implement**

In `lib/integrations/claude-shared.ts`, update `ClaudeContentBlock`:

```ts
export type ClaudeContentBlock =
  | { type: 'text'; text: string }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } }
  | { type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg'; data: string } };
```

No other change needed — `requestClaudeJson` already forwards `userContent` verbatim into the request body.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/integrations/claude-shared.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/integrations/claude-shared.ts tests/unit/lib/integrations/claude-shared.test.ts
git commit -m "feat(claude): add image content block support"
```

---

### Task 3: Frame extractor client

**Files:**
- Create: `lib/integrations/frame-extractor.ts`
- Test: `tests/unit/lib/integrations/frame-extractor.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `createApifyFrameExtractorClient(apiToken)` returning a `FrameExtractorClient` with `extractFrames(videoUrl, timestampSeconds): Promise<ExtractedFrame[]>`, `fetchImageAsBase64(url): Promise<string>`, and the `HOOK_WINDOW_TIMESTAMPS_SECONDS` constant — all consumed by Task 6 (`enrich-handler.ts`) and Task 7 (route wiring).

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/lib/integrations/frame-extractor.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createApifyFrameExtractorClient, fetchImageAsBase64 } from '@/lib/integrations/frame-extractor';

describe('createApifyFrameExtractorClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends videoUrls as {url} objects and lowercase outputFormat, filters to succeeded frames', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        { status: 'succeeded', timestampSeconds: 0, storedFileUrl: 'https://api.apify.com/v2/key-value-stores/x/records/frame-0.jpg' },
        { status: 'failed', timestampSeconds: 0.5 },
        { status: 'succeeded', timestampSeconds: 1, storedFileUrl: 'https://api.apify.com/v2/key-value-stores/x/records/frame-1.jpg' },
      ],
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createApifyFrameExtractorClient('test-token');
    const frames = await client.extractFrames('https://example.com/video.mp4', [0, 0.5, 1]);

    expect(frames).toEqual([
      { timestampSeconds: 0, imageUrl: 'https://api.apify.com/v2/key-value-stores/x/records/frame-0.jpg?token=test-token' },
      { timestampSeconds: 1, imageUrl: 'https://api.apify.com/v2/key-value-stores/x/records/frame-1.jpg?token=test-token' },
    ]);

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(requestBody.videoUrls).toEqual([{ url: 'https://example.com/video.mp4' }]);
    expect(requestBody.outputFormat).toBe('jpeg');
    expect(requestBody.timestampSeconds).toEqual([0, 0.5, 1]);
  });

  it('throws when the actor call fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400 }));
    const client = createApifyFrameExtractorClient('test-token');
    await expect(client.extractFrames('https://example.com/video.mp4', [0])).rejects.toThrow('400');
  });
});

describe('fetchImageAsBase64', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches and base64-encodes an image', async () => {
    const fakeBytes = new Uint8Array([1, 2, 3]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => fakeBytes.buffer }));

    const result = await fetchImageAsBase64('https://example.com/frame.jpg');

    expect(result).toBe(Buffer.from(fakeBytes).toString('base64'));
  });

  it('throws when the image fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(fetchImageAsBase64('https://example.com/frame.jpg')).rejects.toThrow('404');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/lib/integrations/frame-extractor.test.ts`
Expected: FAIL with `Cannot find module '@/lib/integrations/frame-extractor'`

- [ ] **Step 3: Implement**

Create `lib/integrations/frame-extractor.ts`:

```ts
export interface ExtractedFrame {
  timestampSeconds: number;
  imageUrl: string;
}

export interface FrameExtractorClient {
  extractFrames(videoUrl: string, timestampSeconds: number[]): Promise<ExtractedFrame[]>;
}

const FRAME_EXTRACTOR_ACTOR_ID = 'automation-lab~video-thumbnail-frame-extractor';

// First 5 seconds, sampled every half second — validated against a real video
// during this feature's design (all 10/10 frames succeeded). Denser than
// 1-second sampling roughly doubles the per-diagnostic Apify cost, but stays
// well under the cost of TikTok's native full-video AI add-ons for any video
// longer than ~36s — see design spec §5.
export const HOOK_WINDOW_TIMESTAMPS_SECONDS = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5];

export function createApifyFrameExtractorClient(apiToken: string): FrameExtractorClient {
  return {
    async extractFrames(videoUrl: string, timestampSeconds: number[]): Promise<ExtractedFrame[]> {
      const response = await fetch(
        `https://api.apify.com/v2/acts/${FRAME_EXTRACTOR_ACTOR_ID}/run-sync-get-dataset-items?token=${apiToken}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            // NOT plain strings — the actor's schema requires {url} objects.
            // A plain string array fails with a misleading "do not contain
            // valid URLs" error even for a real, reachable URL. Confirmed
            // during this feature's design.
            videoUrls: [{ url: videoUrl }],
            timestampSeconds,
            // Lowercase — "JPEG" is rejected by the actor's enum validation.
            // Confirmed during this feature's design.
            outputFormat: 'jpeg',
            quality: 85,
          }),
        }
      );
      if (!response.ok) {
        throw new Error(`Frame extraction failed with status ${response.status}`);
      }
      const items: Array<Record<string, unknown>> = await response.json();
      return items
        .filter((item) => item.status === 'succeeded')
        .map((item) => ({
          timestampSeconds: Number(item.timestampSeconds),
          imageUrl: `${String(item.storedFileUrl)}?token=${apiToken}`,
        }));
    },
  };
}

export async function fetchImageAsBase64(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch frame image: ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  return Buffer.from(buffer).toString('base64');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/lib/integrations/frame-extractor.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/integrations/frame-extractor.ts tests/unit/lib/integrations/frame-extractor.test.ts
git commit -m "feat(diagnostic): add Apify frame-extractor client"
```

---

### Task 4: TikTok video acquisition on ScraperClient

**Files:**
- Modify: `lib/integrations/scraper.ts`
- Modify: `tests/fakes/scraper.fake.ts`
- Test: `tests/unit/lib/integrations/scraper.test.ts`

**Interfaces:**
- Consumes: nothing new — reuses the existing `run-sync-get-dataset-items` Apify pattern already in this file.
- Produces: `PlatformNotSupportedError`, `DownloadedVideo`, and `ScraperClient.fetchVideoForAnalysis(platform, url): Promise<DownloadedVideo>`, consumed by Task 6 (`enrich-handler.ts`).

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/lib/integrations/scraper.test.ts`, inside the `describe('createApifyScraperClient', ...)` block:

```ts
describe('fetchVideoForAnalysis', () => {
  it('fetches a downloadable video, duration, and transcript for TikTok', async () => {
    const scrapeResponse = {
      ok: true,
      status: 200,
      json: async () => [
        {
          mediaUrls: ['https://api.apify.com/v2/key-value-stores/abc/records/video-123.mp4'],
          videoMeta: {
            duration: 50.534,
            transcriptionLink: 'https://api.apify.com/v2/key-value-stores/xyz/records/transcription-123.txt',
          },
        },
      ],
    };
    const transcriptResponse = { ok: true, text: async () => 'You can actually play GTA 6 early.' };
    const sequencedFetch = vi.fn()
      .mockResolvedValueOnce(scrapeResponse)
      .mockResolvedValueOnce(transcriptResponse);
    vi.stubGlobal('fetch', sequencedFetch);

    const client = createApifyScraperClient('test-token');
    const video = await client.fetchVideoForAnalysis('tiktok', 'https://www.tiktok.com/@user/video/123');

    expect(video.videoUrl).toBe('https://api.apify.com/v2/key-value-stores/abc/records/video-123.mp4?token=test-token');
    expect(video.durationSeconds).toBe(50.534);
    expect(video.transcript).toBe('You can actually play GTA 6 early.');

    const firstCallBody = JSON.parse(sequencedFetch.mock.calls[0][1].body as string);
    expect(firstCallBody).toEqual({
      postURLs: ['https://www.tiktok.com/@user/video/123'],
      shouldDownloadVideos: true,
      downloadSubtitlesOptions: 'TRANSCRIBE_ALL_VIDEOS',
    });
    expect(sequencedFetch.mock.calls[1][0]).toContain('transcription-123.txt?token=test-token');
  });

  it('returns a null transcript (not throwing) when transcriptionLink is missing', async () => {
    const scrapeResponse = {
      ok: true,
      status: 200,
      json: async () => [{ mediaUrls: ['https://api.apify.com/v2/key-value-stores/abc/records/video-123.mp4'], videoMeta: { duration: 30 } }],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(scrapeResponse));

    const client = createApifyScraperClient('test-token');
    const video = await client.fetchVideoForAnalysis('tiktok', 'https://www.tiktok.com/@user/video/123');

    expect(video.transcript).toBeNull();
  });

  it('throws when no downloadable video is present in the response', async () => {
    const scrapeResponse = { ok: true, status: 200, json: async () => [{ videoMeta: { duration: 30 } }] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(scrapeResponse));

    const client = createApifyScraperClient('test-token');
    await expect(client.fetchVideoForAnalysis('tiktok', 'https://www.tiktok.com/@user/video/123')).rejects.toThrow(
      'No downloadable video found'
    );
  });

  it('throws PlatformNotSupportedError for instagram, without making any request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const client = createApifyScraperClient('test-token');
    await expect(
      client.fetchVideoForAnalysis('instagram', 'https://www.instagram.com/reel/abc123/')
    ).rejects.toThrow(PlatformNotSupportedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

Add `PlatformNotSupportedError` to this test file's existing import from `@/lib/integrations/scraper`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/lib/integrations/scraper.test.ts`
Expected: FAIL — `fetchVideoForAnalysis is not a function`, `PlatformNotSupportedError` is not exported

- [ ] **Step 3: Implement**

In `lib/integrations/scraper.ts`, add near the top (after the existing interfaces):

```ts
export interface DownloadedVideo {
  videoUrl: string; // fetchable, includes the Apify token as a query param
  durationSeconds: number;
  transcript: string | null; // best-effort; null if unavailable
}

export class PlatformNotSupportedError extends Error {
  constructor(public readonly platform: string) {
    super(`Visual/audio analysis is not yet available for ${platform}.`);
  }
}
```

Add `fetchVideoForAnalysis` to the `ScraperClient` interface:

```ts
export interface ScraperClient {
  detectPlatform(url: string): 'tiktok' | 'instagram' | null;
  fetchPost(url: string): Promise<SocialPostMetadata>;
  fetchProfilePosts(platform: 'tiktok' | 'instagram', handle: string): Promise<ProfilePost[]>;
  /**
   * Downloads the real video file and (best-effort) transcribes it, for the
   * visual/audio enrichment pass — distinct from fetchPost, which never
   * downloads media. Instagram throws PlatformNotSupportedError until its own
   * video-acquisition path is validated and built. See design spec §2.
   */
  fetchVideoForAnalysis(platform: 'tiktok' | 'instagram', url: string): Promise<DownloadedVideo>;
}
```

Add a new helper near `runApifyActorAndWait`:

```ts
function buildVideoDownloadInput(url: string): Record<string, unknown> {
  return {
    postURLs: [url],
    shouldDownloadVideos: true,
    downloadSubtitlesOptions: 'TRANSCRIBE_ALL_VIDEOS',
  };
}

async function fetchTranscript(transcriptionLink: string | undefined, apiToken: string): Promise<string | null> {
  if (!transcriptionLink) return null;
  try {
    const response = await fetch(`${transcriptionLink}?token=${apiToken}`);
    if (!response.ok) return null;
    const text = (await response.text()).trim();
    return text.length > 0 ? text : null;
  } catch {
    // Never let a failed transcript fetch fail the whole enrichment — see design spec §7.
    return null;
  }
}
```

Add `fetchVideoForAnalysis` to the object returned by `createApifyScraperClient`:

```ts
async fetchVideoForAnalysis(platform: 'tiktok' | 'instagram', url: string): Promise<DownloadedVideo> {
  if (platform === 'instagram') {
    throw new PlatformNotSupportedError('instagram');
  }
  const runUrl = `https://api.apify.com/v2/acts/${APIFY_ACTORS.tiktok}/run-sync-get-dataset-items?token=${apiToken}`;
  const response = await fetch(runUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildVideoDownloadInput(url)),
  });
  if (!response.ok) {
    throw new Error(`Apify video download failed with status ${response.status}`);
  }
  const items = await response.json();
  const item = items[0];
  if (!item) {
    throw new Error(`Apify returned no data for ${url}`);
  }
  const videoMeta = item.videoMeta ?? {};
  const rawVideoUrl = item.mediaUrls?.[0] ?? videoMeta.downloadAddr;
  if (!rawVideoUrl) {
    throw new Error(`No downloadable video found for ${url}`);
  }
  const transcript = await fetchTranscript(videoMeta.transcriptionLink, apiToken);
  return {
    videoUrl: `${rawVideoUrl}?token=${apiToken}`,
    durationSeconds: Number(videoMeta.duration ?? 0),
    transcript,
  };
},
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/lib/integrations/scraper.test.ts`
Expected: PASS

- [ ] **Step 5: Update the fake**

In `tests/fakes/scraper.fake.ts`, add a `fetchVideoForAnalysis` implementation, overridable like the existing `metadata`:

```ts
import type { ScraperClient, SocialPostMetadata, ProfilePost, DownloadedVideo } from '@/lib/integrations/scraper';
import { detectSocialPlatform, PlatformNotSupportedError } from '@/lib/integrations/scraper';

export function createFakeScraperClient(
  overrides: Partial<SocialPostMetadata> = {},
  profilePosts: ProfilePost[] = [],
  downloadedVideo: Partial<DownloadedVideo> = {}
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
  const video: DownloadedVideo = {
    videoUrl: 'https://api.apify.com/v2/key-value-stores/fake/records/video-fake.mp4?token=fake-token',
    durationSeconds: 28,
    transcript: 'This is a fake transcript.',
    ...downloadedVideo,
  };
  return {
    detectPlatform: detectSocialPlatform,
    fetchPost: async () => metadata,
    fetchProfilePosts: async () => profilePosts,
    fetchVideoForAnalysis: async (platform) => {
      if (platform === 'instagram') {
        throw new PlatformNotSupportedError('instagram');
      }
      return video;
    },
  };
}
```

Run: `npx tsc --noEmit` to confirm no existing callers of `createFakeScraperClient` break (the new third parameter is optional, appended at the end).

- [ ] **Step 6: Commit**

```bash
git add lib/integrations/scraper.ts tests/unit/lib/integrations/scraper.test.ts tests/fakes/scraper.fake.ts
git commit -m "feat(diagnostic): add TikTok video acquisition for visual/audio analysis"
```

---

### Task 5: Claude visual/audio analysis client

**Files:**
- Create: `lib/integrations/claude-visual-audio.ts`
- Test: `tests/unit/lib/integrations/claude-visual-audio.test.ts`

**Interfaces:**
- Consumes: `ClaudeContentBlock` (Task 2), `requestClaudeJson`/`escapeForContainmentTag` from `./claude-shared` (existing).
- Produces: `createClaudeVisualAudioClient(apiKey)` returning a `ClaudeVisualAudioClient` with `analyzeVisualAudio(input): Promise<{ narrative: string }>`, consumed by Task 6 (`enrich-handler.ts`).

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/lib/integrations/claude-visual-audio.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createClaudeVisualAudioClient } from '@/lib/integrations/claude-visual-audio';

describe('createClaudeVisualAudioClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends one image block per frame, in order, plus the transcript and Hook Strength context', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ content: [{ text: '{"narrative":"Strong opening frame with clear on-screen text."}' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createClaudeVisualAudioClient('test-key');
    const result = await client.analyzeVisualAudio({
      platform: 'tiktok',
      frameJpegBase64: ['ZmFrZS1mcmFtZS0w', 'ZmFrZS1mcmFtZS0x'],
      transcript: 'You can actually play GTA 6 early.',
      hookStrengthScore: { value: 72, label: 'strong' },
    });

    expect(result.narrative).toBe('Strong opening frame with clear on-screen text.');

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const content = body.messages[0].content as Array<Record<string, unknown>>;
    const imageBlocks = content.filter((b) => b.type === 'image');
    expect(imageBlocks).toHaveLength(2);
    expect((imageBlocks[0].source as { data: string }).data).toBe('ZmFrZS1mcmFtZS0w');
    expect((imageBlocks[1].source as { data: string }).data).toBe('ZmFrZS1mcmFtZS0x');
    const firstTextBlock = content[0].text as string;
    expect(firstTextBlock).toContain('Hook Strength score (from engagement data alone): 72 (strong)');
    expect(firstTextBlock).toContain('You can actually play GTA 6 early.');
  });

  it('phrases an absent transcript clearly instead of leaving it blank', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ content: [{ text: '{"narrative":"..."}' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createClaudeVisualAudioClient('test-key');
    await client.analyzeVisualAudio({
      platform: 'tiktok',
      frameJpegBase64: ['ZmFrZQ=='],
      transcript: null,
      hookStrengthScore: { value: 50, label: 'moderate' },
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const firstTextBlock = body.messages[0].content[0].text as string;
    expect(firstTextBlock).toContain('(not available for this video)');
  });

  it('defaults to an empty narrative if the response omits it, rather than throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ content: [{ text: '{}' }] }),
    }));

    const client = createClaudeVisualAudioClient('test-key');
    const result = await client.analyzeVisualAudio({
      platform: 'tiktok',
      frameJpegBase64: ['ZmFrZQ=='],
      transcript: null,
      hookStrengthScore: { value: 50, label: 'moderate' },
    });

    expect(result.narrative).toBe('');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/lib/integrations/claude-visual-audio.test.ts`
Expected: FAIL with `Cannot find module '@/lib/integrations/claude-visual-audio'`

- [ ] **Step 3: Implement**

Create `lib/integrations/claude-visual-audio.ts`:

```ts
import { requestClaudeJson, escapeForContainmentTag, type ClaudeContentBlock } from './claude-shared';

export interface VisualAudioAnalysisInput {
  platform: 'youtube' | 'tiktok' | 'instagram';
  frameJpegBase64: string[]; // ordered by timestamp, already base64-encoded by the caller
  transcript: string | null;
  hookStrengthScore: { value: number; label: string }; // existing fast-path score, for consistency
}

export interface VisualAudioAnalysis {
  narrative: string;
}

export interface ClaudeVisualAudioClient {
  analyzeVisualAudio(input: VisualAudioAnalysisInput): Promise<VisualAudioAnalysis>;
}

export const VISUAL_AUDIO_SYSTEM_PROMPT = `You are the visual/audio content reviewer for Creator Dashboard, a tool for creators under 5,000 followers who are new to analytics.
You are shown still frames sampled from the first 5 seconds of a short-form video, roughly every half second, in chronological order, plus (when available) a transcript of the full video's narration.
Write a short, honest, plain-English read (3-5 sentences) of whether these first 5 seconds actually hook a scrolling viewer: is there a clear visual subject immediately, is there on-screen text or motion that stops the scroll, does the framing/lighting look intentional or accidental, and (if a transcript is present) does the opening line match or undercut what's on screen.
This creator already has a numeric Hook Strength score from engagement data alone (given below) — you are adding what that number can't see: what the hook actually looks and sounds like. Don't just restate the number; say something the number couldn't tell them.
Keep the tone encouraging but honest, and end with one concrete, actionable suggestion if the hook is weak. Never claim to have watched the full video — you only saw the first 5 seconds of frames plus (if given) a transcript.`;

export function createClaudeVisualAudioClient(apiKey: string, model = 'claude-sonnet-5'): ClaudeVisualAudioClient {
  return {
    async analyzeVisualAudio(input: VisualAudioAnalysisInput): Promise<VisualAudioAnalysis> {
      const content: ClaudeContentBlock[] = [
        {
          type: 'text',
          text: `Platform: ${input.platform}\nExisting Hook Strength score (from engagement data alone): ${input.hookStrengthScore.value} (${input.hookStrengthScore.label})\nTranscript: ${input.transcript ? escapeForContainmentTag(input.transcript) : '(not available for this video)'}\n\nFrames follow, in chronological order from 0s to ~4.5s:`,
        },
        ...input.frameJpegBase64.map(
          (data): ClaudeContentBlock => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } })
        ),
        { type: 'text', text: 'Respond as JSON: {"narrative": string}' },
      ];
      const parsed = await requestClaudeJson<{ narrative?: string }>({
        apiKey,
        model,
        maxTokens: 512,
        system: VISUAL_AUDIO_SYSTEM_PROMPT,
        userContent: content,
      });
      return { narrative: parsed.narrative ?? '' };
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/lib/integrations/claude-visual-audio.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/integrations/claude-visual-audio.ts tests/unit/lib/integrations/claude-visual-audio.test.ts
git commit -m "feat(diagnostic): add Claude visual/audio analysis client"
```

---

### Task 6: Enrichment handler

**Files:**
- Create: `lib/diagnostic/enrich-handler.ts`
- Test: `tests/unit/lib/diagnostic/enrich-handler.test.ts`

**Interfaces:**
- Consumes: `ScraperClient.fetchVideoForAnalysis` (Task 4), `FrameExtractorClient`/`HOOK_WINDOW_TIMESTAMPS_SECONDS`/`fetchImageAsBase64` (Task 3), `ClaudeVisualAudioClient` (Task 5).
- Produces: `handleEnrichRequest(deps, context): Promise<EnrichHandlerResult>`, consumed by Task 7 (the API route).

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/lib/diagnostic/enrich-handler.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { handleEnrichRequest, type EnrichHandlerDeps, type DiagnosticForEnrichment } from '@/lib/diagnostic/enrich-handler';
import { PlatformNotSupportedError } from '@/lib/integrations/scraper';

function makeDeps(overrides: Partial<EnrichHandlerDeps> = {}): EnrichHandlerDeps {
  const diagnostic: DiagnosticForEnrichment = {
    profileId: 'profile-1',
    platform: 'tiktok',
    inputUrl: 'https://www.tiktok.com/@user/video/123',
    hookStrengthScore: 72,
    hookStrengthLabel: 'strong',
  };
  return {
    hasActiveSubscription: async () => true,
    getDiagnostic: async () => diagnostic,
    scraperClient: {
      fetchVideoForAnalysis: async () => ({
        videoUrl: 'https://api.apify.com/v2/key-value-stores/fake/records/video.mp4?token=fake',
        durationSeconds: 30,
        transcript: 'A fake transcript.',
      }),
    },
    frameExtractorClient: {
      extractFrames: async () => [
        { timestampSeconds: 0, imageUrl: 'https://example.com/frame-0.jpg' },
        { timestampSeconds: 0.5, imageUrl: 'https://example.com/frame-1.jpg' },
      ],
    },
    visualAudioClient: {
      analyzeVisualAudio: async () => ({ narrative: 'A clear, encouraging read of the hook.' }),
    },
    fetchImageAsBase64: async () => 'ZmFrZS1mcmFtZQ==',
    saveEnrichment: async () => {},
    ...overrides,
  };
}

describe('handleEnrichRequest', () => {
  it('returns 401 when not signed in', async () => {
    const result = await handleEnrichRequest(makeDeps(), { profileId: null, diagnosticId: 'diag-1' });
    expect(result.status).toBe(401);
  });

  it('returns 404 when the diagnostic does not exist', async () => {
    const deps = makeDeps({ getDiagnostic: async () => null });
    const result = await handleEnrichRequest(deps, { profileId: 'profile-1', diagnosticId: 'diag-1' });
    expect(result.status).toBe(404);
  });

  it('returns 403 when the diagnostic belongs to a different profile', async () => {
    const deps = makeDeps();
    const result = await handleEnrichRequest(deps, { profileId: 'someone-else', diagnosticId: 'diag-1' });
    expect(result.status).toBe(403);
  });

  it('returns 402 with an upgrade URL when the profile has no active subscription', async () => {
    const deps = makeDeps({ hasActiveSubscription: async () => false });
    const result = await handleEnrichRequest(deps, { profileId: 'profile-1', diagnosticId: 'diag-1' });
    expect(result.status).toBe(402);
    expect(result.body.upgradeUrl).toBe('/billing');
  });

  it('returns 422 for a non-tiktok platform, without writing any status or calling any client', async () => {
    const saveEnrichment = vi.fn();
    const fetchVideoForAnalysis = vi.fn();
    const deps = makeDeps({
      getDiagnostic: async () => ({
        profileId: 'profile-1',
        platform: 'instagram',
        inputUrl: 'https://www.instagram.com/reel/abc/',
        hookStrengthScore: 50,
        hookStrengthLabel: 'moderate',
      }),
      scraperClient: { fetchVideoForAnalysis },
      saveEnrichment,
    });

    const result = await handleEnrichRequest(deps, { profileId: 'profile-1', diagnosticId: 'diag-1' });

    expect(result.status).toBe(422);
    expect(saveEnrichment).not.toHaveBeenCalled();
    expect(fetchVideoForAnalysis).not.toHaveBeenCalled();
  });

  it('writes pending then complete, and returns the narrative, on the happy path', async () => {
    const saveEnrichment = vi.fn();
    const deps = makeDeps({ saveEnrichment });

    const result = await handleEnrichRequest(deps, { profileId: 'profile-1', diagnosticId: 'diag-1' });

    expect(result.status).toBe(200);
    expect(result.body.narrative).toBe('A clear, encouraging read of the hook.');
    expect(saveEnrichment).toHaveBeenCalledWith({ diagnosticId: 'diag-1', status: 'pending' });
    expect(saveEnrichment).toHaveBeenCalledWith({
      diagnosticId: 'diag-1',
      status: 'complete',
      narrative: 'A clear, encouraging read of the hook.',
    });
  });

  it('saves a failed status and returns a clear message when zero frames are extracted', async () => {
    const saveEnrichment = vi.fn();
    const deps = makeDeps({
      frameExtractorClient: { extractFrames: async () => [] },
      saveEnrichment,
    });

    const result = await handleEnrichRequest(deps, { profileId: 'profile-1', diagnosticId: 'diag-1' });

    expect(result.status).toBe(500);
    expect(result.body.error).toContain("Couldn't process this video");
    expect(saveEnrichment).toHaveBeenCalledWith(
      expect.objectContaining({ diagnosticId: 'diag-1', status: 'failed' })
    );
  });

  it('saves a failed status and returns a generic message when a pipeline step throws', async () => {
    const saveEnrichment = vi.fn();
    const deps = makeDeps({
      scraperClient: {
        fetchVideoForAnalysis: async () => {
          throw new Error('Apify video download failed with status 500');
        },
      },
      saveEnrichment,
    });

    const result = await handleEnrichRequest(deps, { profileId: 'profile-1', diagnosticId: 'diag-1' });

    expect(result.status).toBe(500);
    expect(result.body.error).toBe('Something went wrong analyzing this video. Please try again.');
    expect(saveEnrichment).toHaveBeenCalledWith(
      expect.objectContaining({ diagnosticId: 'diag-1', status: 'failed', error: 'Apify video download failed with status 500' })
    );
  });

  it('propagates PlatformNotSupportedError from fetchVideoForAnalysis as a clean failure, not a crash', async () => {
    const saveEnrichment = vi.fn();
    const deps = makeDeps({
      scraperClient: {
        fetchVideoForAnalysis: async () => {
          throw new PlatformNotSupportedError('instagram');
        },
      },
      saveEnrichment,
    });

    const result = await handleEnrichRequest(deps, { profileId: 'profile-1', diagnosticId: 'diag-1' });

    expect(result.status).toBe(500);
    expect(saveEnrichment).toHaveBeenCalledWith(
      expect.objectContaining({ diagnosticId: 'diag-1', status: 'failed' })
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/lib/diagnostic/enrich-handler.test.ts`
Expected: FAIL with `Cannot find module '@/lib/diagnostic/enrich-handler'`

- [ ] **Step 3: Implement**

Create `lib/diagnostic/enrich-handler.ts`:

```ts
import type { ScraperClient } from '@/lib/integrations/scraper';
import type { FrameExtractorClient } from '@/lib/integrations/frame-extractor';
import { HOOK_WINDOW_TIMESTAMPS_SECONDS } from '@/lib/integrations/frame-extractor';
import type { ClaudeVisualAudioClient } from '@/lib/integrations/claude-visual-audio';

export interface DiagnosticForEnrichment {
  profileId: string;
  platform: 'youtube' | 'tiktok' | 'instagram';
  inputUrl: string;
  hookStrengthScore: number;
  hookStrengthLabel: string;
}

export interface EnrichHandlerDeps {
  hasActiveSubscription: (profileId: string) => Promise<boolean>;
  getDiagnostic: (id: string) => Promise<DiagnosticForEnrichment | null>;
  scraperClient: Pick<ScraperClient, 'fetchVideoForAnalysis'>;
  frameExtractorClient: FrameExtractorClient;
  visualAudioClient: ClaudeVisualAudioClient;
  fetchImageAsBase64: (url: string) => Promise<string>;
  saveEnrichment: (params: {
    diagnosticId: string;
    status: 'pending' | 'complete' | 'failed';
    narrative?: string;
    error?: string;
  }) => Promise<void>;
}

export interface EnrichRequestContext {
  profileId: string | null;
  diagnosticId: string;
}

export interface EnrichHandlerResult {
  status: number;
  body: Record<string, unknown>;
}

export async function handleEnrichRequest(
  deps: EnrichHandlerDeps,
  context: EnrichRequestContext
): Promise<EnrichHandlerResult> {
  if (!context.profileId) {
    return { status: 401, body: { error: 'You must be signed in to run this analysis.' } };
  }

  const diagnostic = await deps.getDiagnostic(context.diagnosticId);
  if (!diagnostic) {
    return { status: 404, body: { error: 'Diagnostic not found.' } };
  }
  if (diagnostic.profileId !== context.profileId) {
    return { status: 403, body: { error: 'You do not have access to this diagnostic.' } };
  }
  if (!(await deps.hasActiveSubscription(context.profileId))) {
    return {
      status: 402,
      body: { error: 'Visual & Audio Analysis requires an active subscription.', upgradeUrl: '/billing' },
    };
  }
  // Both YouTube and Instagram are statically known unsupported today — decided
  // up front, before writing any status, so a request that can never resolve
  // to 'complete'/'failed' never gets left showing "in progress" forever. See
  // design spec §5 step 4.
  if (diagnostic.platform !== 'tiktok') {
    return { status: 422, body: { error: `Visual & Audio Analysis is not available for ${diagnostic.platform} yet.` } };
  }

  await deps.saveEnrichment({ diagnosticId: context.diagnosticId, status: 'pending' });

  try {
    const video = await deps.scraperClient.fetchVideoForAnalysis('tiktok', diagnostic.inputUrl);
    const frames = await deps.frameExtractorClient.extractFrames(video.videoUrl, HOOK_WINDOW_TIMESTAMPS_SECONDS);
    if (frames.length === 0) {
      const message = "Couldn't process this video — it may be too short or in an unsupported format.";
      await deps.saveEnrichment({ diagnosticId: context.diagnosticId, status: 'failed', error: message });
      return { status: 500, body: { error: message } };
    }

    const frameJpegBase64 = await Promise.all(frames.map((frame) => deps.fetchImageAsBase64(frame.imageUrl)));
    const analysis = await deps.visualAudioClient.analyzeVisualAudio({
      platform: diagnostic.platform,
      frameJpegBase64,
      transcript: video.transcript,
      hookStrengthScore: { value: diagnostic.hookStrengthScore, label: diagnostic.hookStrengthLabel },
    });

    await deps.saveEnrichment({
      diagnosticId: context.diagnosticId,
      status: 'complete',
      narrative: analysis.narrative,
    });
    return { status: 200, body: { narrative: analysis.narrative } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Visual/audio enrichment failed:', message);
    await deps.saveEnrichment({ diagnosticId: context.diagnosticId, status: 'failed', error: message });
    return { status: 500, body: { error: 'Something went wrong analyzing this video. Please try again.' } };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/lib/diagnostic/enrich-handler.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/diagnostic/enrich-handler.ts tests/unit/lib/diagnostic/enrich-handler.test.ts
git commit -m "feat(diagnostic): add visual/audio enrichment handler"
```

---

### Task 7: Enrichment API route

**Files:**
- Create: `app/api/diagnostic/[id]/enrich/route.ts`

**Interfaces:**
- Consumes: `handleEnrichRequest` (Task 6), `createApifyScraperClient` (existing, extended by Task 4), `createApifyFrameExtractorClient`/`fetchImageAsBase64` (Task 3), `createClaudeVisualAudioClient` (Task 5), `hasActiveSubscription` (existing, `lib/billing/entitlements.ts`).
- Produces: `POST /api/diagnostic/[id]/enrich`, the endpoint Task 8's frontend calls.

This task wires real dependencies into an already-tested handler (Task 6) — Next.js route handlers in this codebase are not unit-tested directly (see `app/api/diagnostic/route.ts`, `app/api/ideas/route.ts`), so this task is implement-and-typecheck, not TDD.

- [ ] **Step 1: Implement**

Create `app/api/diagnostic/[id]/enrich/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { hasActiveSubscription } from '@/lib/billing/entitlements';
import { createApifyScraperClient } from '@/lib/integrations/scraper';
import { createApifyFrameExtractorClient, fetchImageAsBase64 } from '@/lib/integrations/frame-extractor';
import { createClaudeVisualAudioClient } from '@/lib/integrations/claude-visual-audio';
import { handleEnrichRequest, type DiagnosticForEnrichment } from '@/lib/diagnostic/enrich-handler';

export const maxDuration = 60; // Hobby plan's real ceiling — see design spec decision 1.

function extractHookStrength(reportJson: unknown): { score: number; label: string } {
  const report = reportJson as { scores?: { hookStrength?: { score: number; label: string } } } | null;
  return report?.scores?.hookStrength ?? { score: 0, label: 'weak' };
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const serviceClient = createSupabaseServiceRoleClient();

    const result = await handleEnrichRequest(
      {
        hasActiveSubscription: (profileId) => hasActiveSubscription(serviceClient, profileId),
        getDiagnostic: async (diagnosticId): Promise<DiagnosticForEnrichment | null> => {
          const { data } = await serviceClient
            .from('diagnostics')
            .select('profile_id, platform, input_url, report_json')
            .eq('id', diagnosticId)
            .maybeSingle();
          if (!data) return null;
          const hookStrength = extractHookStrength(data.report_json);
          return {
            profileId: data.profile_id,
            platform: data.platform,
            inputUrl: data.input_url,
            hookStrengthScore: hookStrength.score,
            hookStrengthLabel: hookStrength.label,
          };
        },
        scraperClient: createApifyScraperClient(process.env.APIFY_API_TOKEN ?? ''),
        frameExtractorClient: createApifyFrameExtractorClient(process.env.APIFY_API_TOKEN ?? ''),
        visualAudioClient: createClaudeVisualAudioClient(process.env.ANTHROPIC_API_KEY ?? ''),
        fetchImageAsBase64,
        saveEnrichment: async ({ diagnosticId, status, narrative, error }) => {
          await serviceClient
            .from('diagnostics')
            .update({
              visual_audio_status: status,
              visual_audio_narrative: narrative ?? null,
              visual_audio_error: error ?? null,
            })
            .eq('id', diagnosticId);
        },
      },
      { profileId: user?.id ?? null, diagnosticId: id }
    );

    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    console.error('Visual/audio enrichment request failed:', err);
    return NextResponse.json({ error: 'Something went wrong analyzing this video. Please try again.' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS — this is the point a wrong field name or shape mismatch between `enrich-handler.ts`'s `EnrichHandlerDeps` and this route's wiring would surface.

- [ ] **Step 3: Commit**

```bash
git add "app/api/diagnostic/[id]/enrich/route.ts"
git commit -m "feat(diagnostic): add POST /api/diagnostic/[id]/enrich route"
```

---

### Task 8: Frontend — enrich button and narrative display

**Files:**
- Modify: `app/diagnostic/[id]/page.tsx`
- Test: `tests/unit/app/diagnostic/id-page.test.tsx`

**Interfaces:**
- Consumes: `GET /api/diagnostic/[id]`'s now-larger row (Task 1's new columns, plus the pre-existing `platform` column), `POST /api/diagnostic/[id]/enrich` (Task 7).
- Produces: nothing further downstream — this is the final task.

Note one simplification versus the design spec's literal wording in §6: the spec says show the button only when the caller "isn't subscribed" is false, implying a subscription check before rendering. This plan shows the button whenever `platform === 'tiktok'` and no analysis has been requested yet, regardless of subscription status — clicking it for a non-subscriber surfaces the real 402 response (which already carries `upgradeUrl`) as a clear next step, rather than adding a separate subscription-status fetch just to decide whether to render a button. This keeps the page simple and gives an unsubscribed user useful information (that this is a paid feature) instead of hiding it entirely.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/app/diagnostic/id-page.test.tsx`. First add `fireEvent` to the existing import line:

```ts
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
```

Then add these test cases inside the existing `describe('DiagnosticReportPage', ...)` block:

```ts
it('shows the enrich button for a tiktok diagnostic with no visual/audio status yet', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      json: async () => ({
        diagnostic: {
          platform: 'tiktok',
          visual_audio_status: null,
          visual_audio_narrative: null,
          report_json: {
            headline: 'Strong hook',
            scores: { overallScore: 72 },
            explanationSegments: [{ type: 'text', value: 'Good job.' }],
          },
        },
      }),
    })
  );

  render(<DiagnosticReportPage />);

  await waitFor(() =>
    expect(screen.getByRole('button', { name: /see how your first 5 seconds/i })).toBeInTheDocument()
  );
});

it('does not show the enrich button for a non-tiktok diagnostic', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      json: async () => ({
        diagnostic: {
          platform: 'instagram',
          visual_audio_status: null,
          visual_audio_narrative: null,
          report_json: {
            headline: 'Strong hook',
            scores: { overallScore: 72 },
            explanationSegments: [{ type: 'text', value: 'Good job.' }],
          },
        },
      }),
    })
  );

  render(<DiagnosticReportPage />);

  await waitFor(() => expect(screen.getByText('Strong hook')).toBeInTheDocument());
  expect(screen.queryByRole('button', { name: /see how your first 5 seconds/i })).not.toBeInTheDocument();
});

it('clicking the enrich button shows the narrative on success', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({
      json: async () => ({
        diagnostic: {
          platform: 'tiktok',
          visual_audio_status: null,
          visual_audio_narrative: null,
          report_json: {
            headline: 'Strong hook',
            scores: { overallScore: 72 },
            explanationSegments: [{ type: 'text', value: 'Good job.' }],
          },
        },
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ narrative: 'Your opening frame has clear on-screen text that stops the scroll.' }),
    });
  vi.stubGlobal('fetch', fetchMock);

  render(<DiagnosticReportPage />);
  const button = await screen.findByRole('button', { name: /see how your first 5 seconds/i });
  fireEvent.click(button);

  await waitFor(() =>
    expect(screen.getByText('Your opening frame has clear on-screen text that stops the scroll.')).toBeInTheDocument()
  );
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[1][0]).toContain('/enrich');
});

it('shows a retry option when the enrich call fails', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({
      json: async () => ({
        diagnostic: {
          platform: 'tiktok',
          visual_audio_status: null,
          visual_audio_narrative: null,
          report_json: {
            headline: 'Strong hook',
            scores: { overallScore: 72 },
            explanationSegments: [{ type: 'text', value: 'Good job.' }],
          },
        },
      }),
    })
    .mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "Couldn't process this video — it may be too short or in an unsupported format." }),
    });
  vi.stubGlobal('fetch', fetchMock);

  render(<DiagnosticReportPage />);
  const button = await screen.findByRole('button', { name: /see how your first 5 seconds/i });
  fireEvent.click(button);

  await waitFor(() => expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument());
  expect(screen.getByText(/couldn't process this video/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/app/diagnostic/id-page.test.tsx`
Expected: FAIL — the enrich button doesn't exist yet, and `diagnostic.platform`/`visual_audio_status` aren't read from the response yet.

- [ ] **Step 3: Implement**

Replace the contents of `app/diagnostic/[id]/page.tsx`:

```tsx
'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { GlossaryText } from '@/components/GlossaryChip';

interface DiagnosticReportData {
  headline: string;
  scores: { overallScore: number };
  explanationSegments: Array<{ type: 'text' | 'term'; value: string }>;
  confidenceCaveat?: string | null;
}

interface DiagnosticData {
  platform: 'youtube' | 'tiktok' | 'instagram';
  visualAudioStatus: 'pending' | 'complete' | 'failed' | null;
  visualAudioNarrative: string | null;
  report: DiagnosticReportData;
}

export default function DiagnosticReportPage() {
  const params = useParams<{ id: string }>();
  const [diagnostic, setDiagnostic] = useState<DiagnosticData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enriching, setEnriching] = useState(false);
  const [enrichError, setEnrichError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/diagnostic/${params.id}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setError(data.error);
          return;
        }
        setDiagnostic({
          platform: data.diagnostic.platform,
          visualAudioStatus: data.diagnostic.visual_audio_status,
          visualAudioNarrative: data.diagnostic.visual_audio_narrative,
          report: data.diagnostic.report_json,
        });
      })
      .catch(() => {
        if (!cancelled) setError('Something went wrong loading your report. Please try again.');
      });
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  async function handleEnrich() {
    setEnriching(true);
    setEnrichError(null);
    try {
      const res = await fetch(`/api/diagnostic/${params.id}/enrich`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setEnrichError(data.error ?? 'Something went wrong analyzing this video. Please try again.');
        setDiagnostic((prev) => (prev ? { ...prev, visualAudioStatus: 'failed' } : prev));
        return;
      }
      setDiagnostic((prev) =>
        prev ? { ...prev, visualAudioStatus: 'complete', visualAudioNarrative: data.narrative } : prev
      );
    } catch {
      setEnrichError('Something went wrong analyzing this video. Please try again.');
      setDiagnostic((prev) => (prev ? { ...prev, visualAudioStatus: 'failed' } : prev));
    } finally {
      setEnriching(false);
    }
  }

  if (error) {
    return <p role="alert">{error}</p>;
  }

  if (!diagnostic) {
    return <p>Loading your report…</p>;
  }

  const { report } = diagnostic;

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
      <h1 className="text-2xl font-bold text-gray-900">{report.headline}</h1>
      {report.confidenceCaveat && (
        <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">{report.confidenceCaveat}</p>
      )}
      <p className="text-lg text-gray-700">Overall score: {report.scores.overallScore}</p>
      <div className="text-base leading-relaxed text-gray-800">
        <GlossaryText text={report.explanationSegments.map((s) => s.value).join('')} />
      </div>

      {diagnostic.platform === 'tiktok' && !diagnostic.visualAudioStatus && (
        <button
          type="button"
          onClick={handleEnrich}
          disabled={enriching}
          className="self-start rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {enriching ? 'Analyzing your first 5 seconds…' : 'See how your first 5 seconds actually look'}
        </button>
      )}

      {diagnostic.visualAudioStatus === 'complete' && diagnostic.visualAudioNarrative && (
        <div className="rounded-lg bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
          <p className="mb-1 font-semibold">Your first 5 seconds, visually</p>
          <p>{diagnostic.visualAudioNarrative}</p>
        </div>
      )}

      {diagnostic.visualAudioStatus === 'failed' && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
          <p>{enrichError ?? "Couldn't analyze this video."}</p>
          <button type="button" onClick={handleEnrich} disabled={enriching} className="mt-2 font-medium underline">
            Try again
          </button>
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/app/diagnostic/id-page.test.tsx`
Expected: PASS — including the two pre-existing tests in this file (headline/score rendering, confidence caveat, not-found error, network error), since none of them set `diagnostic.platform` to `'tiktok'` and so never expect the button.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS — this is the point where any missed call site across the whole codebase would surface. Fix forward if anything breaks; do not skip this step.

- [ ] **Step 6: Commit**

```bash
git add app/diagnostic/[id]/page.tsx tests/unit/app/diagnostic/id-page.test.tsx
git commit -m "feat(diagnostic): add visual/audio analysis button and narrative display"
```
