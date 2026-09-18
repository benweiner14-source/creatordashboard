# Visual & Audio Content Analysis Design Spec

**Date:** 2026-09-17
**Classification:** Architectural (per `brainstorming`) — new async enrichment endpoint, new DB columns, new third-party video-processing pipeline, new Claude vision capability, paid-tier gating. Builds on top of the existing diagnostic pipeline rather than replacing any part of it.
**Status:** Approved for planning. Reached conversationally with the product owner across this session; the core pipeline (video download → frame extraction) was empirically validated against a real TikTok video before this spec was written, not designed on paper first.

## What this is

A second, optional diagnostic pass that looks at what the existing four-then-five-dimension scorer structurally cannot: **the actual video and audio content**, not just its metadata (view count, duration, caption, publish time). Concretely: does the video's first 5 seconds actually hook a viewer visually, and does the audio/narration hold together? Every existing dimension (Hook Strength, Retention Risk, Timing, Format Fit, Reach) reasons about a post's *numbers*; none of them have ever looked at a single frame of video or a word of what's said in it.

This was scoped down hard during brainstorming. The product owner explicitly rejected a cover-thumbnail-only V1 ("it needs to be the first 5 seconds") as too small a sample to say anything meaningful, so this spec commits to real, multi-frame video analysis from the first pass.

## Decisions already made (inputs to this spec, not open questions)

1. **Two-phase architecture.** The existing `POST /api/diagnostic` stays exactly as-is — fast, synchronous, no video download. This is a **second, separate, opt-in endpoint** (`POST /api/diagnostic/[id]/enrich`) the client calls after the fast report has already loaded. Reason: this project's Vercel plan is **Hobby** (confirmed live via the Vercel API this session — `plan: "hobby"` on team `benweiner14`), whose real function-duration ceiling is 60 seconds regardless of what a route declares. (Aside, not in scope here: `app/api/cron/warroom/route.ts` and `weekly-digest/route.ts` both declare `maxDuration = 300`, which a Hobby plan almost certainly clamps or ignores at deploy time — a pre-existing inconsistency, worth its own follow-up, not fixed by this spec.) Downloading a video, extracting frames, transcribing audio, and running a vision-capable Claude call is too slow and too variable to risk bundling into the existing fast path.
2. **Real first-5-seconds multi-frame extraction, not a thumbnail.** Standing constraint from the product owner, non-negotiable for this build.
3. **Build our own pipeline (download → extract frames → analyze), rather than delegating to `clockworks/tiktok-scraper`'s native `aiVideoDescription`/`aiVideoSummary`/transcription add-ons.** Empirically validated this session (real cost pull, real output inspection) — decided against the native path for three reasons, in order of weight:
   - **Platform parity.** `apify~instagram-scraper` (the actor this codebase already uses) has zero video-download or AI capability in its entire input schema. No equivalent native feature was found for YouTube either (checked the leading `epctex/youtube-video-downloader` actor and searched the Apify store broadly). TikTok's native AI add-ons are not a pattern we can reuse elsewhere — using them for TikTok only would mean TikTok gets a fundamentally different, better analysis than Instagram/YouTube.
   - **Control.** The native add-ons are an undocumented black box — Apify's own actor README never mentions the underlying model or how it samples the video. An empirical check this session (cross-referencing its output against the post's real caption/hashtags and its own transcript) confirmed it's doing genuine visual analysis, not paraphrasing metadata — but we still can't verify *how much* of the video it looks at or pin it to "first 5 seconds" specifically.
   - **Cost, at this product's typical video lengths.** Native pricing is $0.0016/video-second (both AI add-ons combined), scaling with the *entire* video. DIY frame extraction is a flat ~$0.058/video regardless of length, because it only ever looks at 5 seconds. Crossover is ~36 seconds; most GTA6 commentary/gameplay content in this niche runs longer, so DIY is cheaper on average and the gap widens with length. (Real numbers pulled from Apify's live pricing API and one real billed run this session, at this account's actual SILVER pay-per-event tier — see §5.)
4. **Output shape: a qualitative narrative addition, not a new numeric score dimension.** Unlike Reach (a real numeric threshold that needed real-data calibration), "does this hook visually" and "does the narration hold together" are exactly the kind of judgment call a vision-capable model can already make in prose — forcing it into a single number would manufacture false precision. No new weight in `combineScores`, no new column feeding `overall_score`.
   - **Fast-follow (2026-09-18): episodic/series detection added as a structured field, not narrative-only.** Investigated as "episodic/serialized content signal" — a spike first tried detecting this from caption text alone (real data: ~1-3% base rate across general niches, and mostly false positives in the GTA6 niche specifically, where "X days until GTA6" countdown posts dominate and superficially match episode-numbering patterns). The real signal turned out to be visual/audio — a title card or spoken intro naming an episode/part number in the first 5 seconds — which this pipeline already has the raw material for (frames + transcript). `VisualAudioAnalysis` gained `isEpisodic: boolean` and `seriesLabel: string | null` alongside `narrative`, chosen over folding it into the narrative as prose so the signal is actually queryable/actionable by other features later (e.g. Content Ideas suggesting a creator continue their series) rather than being decorative text a human has to read. Same one Claude call, no added cost. `seriesLabel` is normalized to `null` whenever `isEpisodic` is `false`, so no consumer has to reconcile a contradictory pair itself.
5. **Paid-tier gated.** Real per-diagnostic marginal cost (~$0.06–$0.15 in Apify fees, plus a Claude vision call) is high enough relative to this product's free tier that it should not run automatically or be free. Gate with the existing `hasActiveSubscription` helper (`lib/billing/entitlements.ts`), matching the exact pattern already used by `lib/ideas/handler.ts` (402 + `upgradeUrl`).
6. **TikTok is the only platform with a fully empirically validated pipeline today.** Instagram and YouTube's video-*acquisition* step (getting a real, fetchable video file URL) was not tested this session — see §2 and Non-goals. This spec's implementation plan should treat Instagram/YouTube as needing their own short validation spike (the same kind done for TikTok) before real implementation, not an assumed drop-in extension of the TikTok path.

## Why (validation methodology)

Rather than designing this pipeline on paper, each stage was proven against a real TikTok video (`@nixstah`, a real GTA6-content creator, ~50s video) before being written into this spec:

- Confirmed `clockworks/tiktok-scraper`'s `shouldDownloadVideos: true` input option returns a real, fetchable video file (verified via `curl -I`: `content-type: video/mp4`, 3.3MB — not a placeholder or a truncated file, unlike an earlier false lead: `videoMeta.subtitleLinks[].downloadLink` looks like a real video URL but is only ~2KB, actually the caption payload mislabeled through TikTok's video-CDN URL scheme).
- Confirmed `automation-lab/video-thumbnail-frame-extractor` produces real, correct timestamped JPEG frames from that video at both 1-second and 0.5-second sampling density (all 10/10 frames succeeded at 0.5s sampling) — verified by visually inspecting an extracted frame, which showed the real creator on camera with real on-screen text and real gameplay B-roll matching the actual video content.
- Confirmed, by testing the native TikTok AI add-ons directly and cross-referencing their output against the post's real caption and transcript, that visual descriptions of this kind are achievable and accurate — informing the decision to build the same *capability* ourselves via Claude vision rather than trusting a black box for it.

## Non-goals (explicitly deferred, do not fold into this build)

- **Instagram and YouTube video acquisition are unsolved,** not merely "the same as TikTok." No download mechanism was tested this session for either platform. Candidates identified but not validated: a generic Instagram Reel downloader (none found with confirmed reliability — this codebase's existing experience this session with small third-party Apify actors has been mixed, e.g. the `afanasenko/instagram-reel-script-extractor` transcript actor found during this brainstorm is unverified) and `epctex/youtube-video-downloader` for YouTube (a pure file-download actor, no AI features, output-destination options not yet confirmed to include a directly fetchable URL rather than only cloud-storage upload). **The implementation plan's first task for each of these platforms must be a validation spike identical in spirit to the one already done for TikTok, before any scoring/prompt code is written against it.**
- **Transcription strategy across platforms is not fully settled.** TikTok's own `downloadSubtitlesOptions: "TRANSCRIBE_ALL_VIDEOS"` add-on was validated this session (real, accurate transcript against a real video) and should be used for TikTok. Instagram/YouTube need either a generalized Whisper-based Apify actor fed the acquired video file (once acquisition itself is solved) or another native option discovered during their acquisition spikes — not decided here.
- **Whole-video description/summary** (as opposed to first-5-seconds hook analysis) — a real, different feature (native TikTok add-ons already do this well) that could be built later as its own thing. Not this build.
- **Any new numeric score or change to `overall_score`/`combineScores`** — see decision 4.
- **Bulk/backfill enrichment of historical diagnostics** — this endpoint is per-diagnostic and on-demand only; no batch job.
- **Retry-with-backoff inside the enrichment request itself.** Given the tight 60-second budget (§6), a slow step should fail fast and surface a clear "try again" error rather than retry and risk blowing the budget entirely silently.
- **UI redesign beyond a single new narrative block** — the existing report page (`app/diagnostic/[id]/page.tsx`) gains one new section; no new page, no per-frame gallery UI.

**Fast-follow (2026-09-18): comment-content analysis built as a standalone sibling feature.** Investigated as "comment-content analysis signal" — the question was whether a post's actual comments (not just comment *count*, which the existing scorer already uses) carry a signal worth surfacing. Unlike episodic detection, this didn't fold into the existing Visual & Audio pipeline: it needs no video/frames at all, works identically for TikTok and Instagram (no Instagram/YouTube acquisition gap to work around), and reads from a different Apify actor (`clockworks~tiktok-comments-scraper` for TikTok; Instagram's existing `apify~instagram-scraper` posts-call already returns `latestComments` for free). Built as its own opt-in, paid, per-diagnostic pass (`POST /api/diagnostic/[id]/comments`, `lib/diagnostic/comment-analysis-handler.ts`), mirroring this spec's architecture (pending/complete/failed status column, idempotency short-circuit, generic-error persistence) rather than extending `enrich-handler.ts`.

Two real-data findings shaped the design:
- **Neither actor's native comment ordering can be trusted to reflect popularity.** Verified live: Instagram's `latestComments` is chronological (its name notwithstanding), and TikTok's raw order roughly-but-not-strictly clusters high-like comments first. `fetchComments` (`lib/integrations/scraper.ts`) explicitly re-sorts by `likeCount` descending before truncating, rather than trusting either actor's default order.
- **Structured output over narrative-only, same rationale as `isEpisodic`.** Alongside a short narrative, the response includes `hasContentRequest: boolean` / `contentRequestSummary: string | null` — whether a comment makes a specific, concrete request for future content (e.g. "you should do a pac-man island loot only challenge"), not a vague "more please". This makes the signal queryable/actionable (e.g. feeding Content Ideas later) instead of prose a human has to parse.

Investigated and explicitly **not** built alongside this: fake/bot engagement detection (a false "this looks like bought engagement" call risks real reputational harm to a genuine creator, and organic content-type variance is statistically indistinguishable from fakery without labeled ground truth — recommended against, not attempted).

**Closed (2026-09-18), tip-only, no feature built: native-editor-app algorithmic boost (CapCut/Edits).** Investigated two distinct claims. (1) TikTok favoring videos edited/exported via CapCut or its own native editor: no credible evidence — absent from TikTok's own disclosed ranking-signal list (Transparency Center), and the creator-community discussion of it is contradictory, unresolved anecdote with no controlled testing behind it. (2) Meta's Edits app boosting Instagram Reels reach: real, but not the mechanism initially assumed — Adam Mosseri confirmed directly (Threads, Aug 2025) that Edits gets "a little bit" of a reach boost, but as a deliberate, explicitly **temporary** adoption incentive to seed the app's usage, not because of any video-quality difference (no Meta source confirms Edits gets preferential encoding/bitrate). Either way, nothing here is buildable as a diagnostic signal: pulled real data from `apify~instagram-scraper` and confirmed there is no field anywhere identifying which app produced or published a post — there is nothing in a public post's metadata to detect. The only actionable form is a one-time creator-facing tip ("publish Reels directly through Meta's Edits app for a temporary reach boost"), not a scored feature, and even that tip needs a temporariness caveat since Meta itself has said the incentive won't last.

---

## 1. Data model

New migration, adding three nullable columns to the existing `diagnostics` table (nullable because enrichment is optional, on-demand, and per-diagnostic 1:1 — no new table needed):

```sql
alter table public.diagnostics
  add column visual_audio_status text check (visual_audio_status in ('pending', 'complete', 'failed')),
  add column visual_audio_narrative text,
  add column visual_audio_error text;
```

`visual_audio_status` starts `null` (never requested) until the client calls the enrich endpoint, at which point it's written as `'pending'` before the pipeline runs, then `'complete'`/`'failed'` on completion — mirroring the existing `diagnostics.status` convention for the base diagnostic.

`lib/supabase/types.ts`'s `diagnostics` `Row`/`Insert`/`Update` types gain the matching optional fields.

## 2. Video acquisition (per platform)

**`lib/integrations/scraper.ts`** gains a new exported function, additive (no existing signature changes):

```ts
export interface DownloadedVideo {
  videoUrl: string; // fetchable, may be a token-bearing Apify KVS URL
  durationSeconds: number;
  transcript: string | null; // best-effort; null if unavailable
}

export interface ScraperClient {
  // ...existing methods unchanged...
  fetchVideoForAnalysis(platform: 'tiktok' | 'instagram', url: string): Promise<DownloadedVideo>;
}
```

**TikTok (validated this session):**

```ts
function buildVideoDownloadInput(url: string): Record<string, unknown> {
  return {
    postURLs: [url],
    shouldDownloadVideos: true,
    downloadSubtitlesOptions: 'TRANSCRIBE_ALL_VIDEOS',
  };
}
```

Run via the same `run-sync-get-dataset-items` pattern `fetchPost` already uses (§ existing code). Read `item.mediaUrls[0]` (equivalently `item.videoMeta.downloadAddr`) for `videoUrl`, `item.videoMeta.duration` for `durationSeconds`, and fetch `item.videoMeta.transcriptionLink` (a plain-text file URL) for the transcript — if that link is absent or the fetch fails, set `transcript: null` and continue; never fail the whole enrichment over a missing transcript.

**Instagram: not implemented by this spec.** `fetchVideoForAnalysis('instagram', url)` should throw a clearly-typed error until Instagram's own video-acquisition spike (see Non-goals) lands as a follow-up change:

```ts
export class PlatformNotSupportedError extends Error {
  constructor(public readonly platform: string) {
    super(`Visual/audio analysis is not yet available for ${platform}.`);
  }
}
```

The enrichment handler (§5) catches this specifically and returns a distinct "not available for this platform yet" response rather than a generic failure, so the paid feature doesn't silently look broken.

**YouTube: not wired into this spec at all, not even as a throwing stub.** YouTube's video metadata flows through the separate `YouTubeClient` (`lib/integrations/youtube.ts`), not `ScraperClient` — there is no shared interface to attach a `fetchVideoForAnalysis`-shaped method to without inventing one, and no YouTube acquisition mechanism was even spiked this session (unlike Instagram, which at least shares `ScraperClient` with TikTok). The enrichment handler short-circuits on `platform === 'youtube'` before calling anything (§5 step 4).

## 3. Frame extraction

New file, **`lib/integrations/frame-extractor.ts`**:

```ts
export interface ExtractedFrame {
  timestampSeconds: number;
  imageUrl: string; // Apify KVS URL, same account — fetch + base64-encode before sending to Claude
}

export interface FrameExtractorClient {
  extractFrames(videoUrl: string, timestampSeconds: number[]): Promise<ExtractedFrame[]>;
}

const FRAME_EXTRACTOR_ACTOR_ID = 'automation-lab~video-thumbnail-frame-extractor';

// First 5 seconds, sampled every half second — validated this session (10/10
// frames succeeded on a real video). Denser than 1-second sampling roughly
// doubles the per-diagnostic Apify cost (~$0.046 vs ~$0.025) but the flat,
// video-length-independent DIY approach stays well under the native add-ons'
// cost for any video longer than ~36s regardless — see design spec §5.
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
            videoUrls: [{ url: videoUrl }], // NOT plain strings — the actor's schema requires {url} objects; a plain string array fails with a
                                             // misleading "do not contain valid URLs" error even for a real, reachable URL. Confirmed this session.
            timestampSeconds,
            outputFormat: 'jpeg', // lowercase — "JPEG" is rejected by the actor's enum validation. Confirmed this session.
            quality: 85,
          }),
        }
      );
      if (!response.ok) {
        throw new Error(`Frame extraction failed with status ${response.status}`);
      }
      const items = await response.json();
      return items
        .filter((item: Record<string, unknown>) => item.status === 'succeeded')
        .map((item: Record<string, unknown>) => ({
          timestampSeconds: Number(item.timestampSeconds),
          imageUrl: String(item.storedFileUrl),
        }));
    },
  };
}
```

Frames with `status !== 'succeeded'` (e.g. a corrupt or too-short video) are silently dropped rather than failing the whole call — Claude can still produce a useful read from a partial frame set; an empty result (0 frames) is handled by the caller (§4) as a distinct failure.

## 4. Claude vision analysis

**`lib/integrations/claude-shared.ts`** — `ClaudeContentBlock` gains a new variant, additive:

```ts
export type ClaudeContentBlock =
  | { type: 'text'; text: string }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } }
  | { type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg'; data: string } };
```

New file, **`lib/integrations/claude-visual-audio.ts`**, following the existing single-turn-JSON-client pattern (`claude.ts`, `claude-strategy.ts`):

```ts
import { requestClaudeJson, escapeForContainmentTag, type ClaudeContentBlock } from './claude-shared';

export interface VisualAudioAnalysisInput {
  platform: 'youtube' | 'tiktok' | 'instagram';
  frameJpegBase64: string[]; // ordered by timestamp, already base64-encoded by the caller
  transcript: string | null;
  hookStrengthScore: { value: number; label: string }; // existing fast-path score, for consistency — see prompt below
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

## 5. The enrichment endpoint

New file, **`app/api/diagnostic/[id]/enrich/route.ts`**:

```ts
export const maxDuration = 60; // Hobby plan's real ceiling — see design spec decision 1.
```

New handler, **`lib/diagnostic/enrich-handler.ts`**, following the same injected-dependencies shape as `handler.ts`:

```ts
export interface EnrichHandlerDeps {
  hasActiveSubscription: (profileId: string) => Promise<boolean>;
  getDiagnostic: (id: string) => Promise<{ profileId: string; platform: string; inputUrl: string; hookStrengthScore: number; hookStrengthLabel: string } | null>;
  scraperClient: Pick<ScraperClient, 'fetchVideoForAnalysis'>;
  frameExtractorClient: FrameExtractorClient;
  visualAudioClient: ClaudeVisualAudioClient;
  fetchImageAsBase64: (url: string) => Promise<string>; // injectable for tests
  saveEnrichment: (params: { diagnosticId: string; status: 'complete' | 'failed'; narrative?: string; error?: string }) => Promise<void>;
}
```

Flow:
1. 401 if not signed in (matches existing convention).
2. Load the diagnostic; 404 if missing, **403 if `profileId` doesn't match the caller** (a real gap: today's `GET /api/diagnostic/[id]` has no ownership check at all — out of scope to fix there, but this new *paid, mutating* endpoint must not inherit that gap).
3. 402 (`{ error: '...', upgradeUrl: '/billing' }`) if `!hasActiveSubscription(profileId)` — exact pattern as `lib/ideas/handler.ts`.
4. **If `platform !== 'tiktok'`, return 422 with a "coming soon for this platform" message immediately — before writing any status and before calling any client.** Both YouTube and Instagram are statically known to be unsupported today (§2); there is no reason to write `visual_audio_status: 'pending'` for a request that can never resolve to `'complete'` or `'failed'`, which would otherwise leave the diagnostic stuck showing "in progress" forever. `PlatformNotSupportedError` (§2) exists as a defensive guard inside `fetchVideoForAnalysis` itself, not as this handler's primary mechanism for detecting unsupported platforms — the handler decides statically, up front.
5. Write `visual_audio_status: 'pending'`.
6. Call `scraperClient.fetchVideoForAnalysis('tiktok', inputUrl)` → `extractFrames` (§3, using `HOOK_WINDOW_TIMESTAMPS_SECONDS`) → if 0 frames succeeded, treat as a failure (distinct error message: "Couldn't process this video — it may be too short or in an unsupported format").
7. Fetch each frame's `imageUrl` and base64-encode (`fetchImageAsBase64`).
8. `analyzeVisualAudio` (§4).
9. `saveEnrichment({ status: 'complete', narrative })`; on any thrown error from steps 6-8, `saveEnrichment({ status: 'failed', error: message })` and return a 500 with a generic user-facing message (the specific error is logged server-side only, same convention as `app/api/diagnostic/route.ts`).

**Real per-call cost** (SILVER Apify tier, this account's actual current pricing, pulled live this session):
- TikTok scrape + video-download add-on + transcription: ~$0.001 (actor-start) + $0.0023 (result) + $0.0008 (video-download) + $0.034 (transcription, flat per started minute) ≈ **$0.038**
- Frame extraction, 10 frames at 0.5s sampling: $0.005 (start) + 10 × $0.0040591 ≈ **$0.046**
- Claude vision call (~10 small JPEGs + short prompt, Sonnet): a few cents at most
- **Total: roughly $0.09–0.12 per enrichment call**, well within the paid-tier gating decided above.

## 6. Frontend

**`app/diagnostic/[id]/page.tsx`**: `DiagnosticReportData` gains:

```ts
visualAudioStatus?: 'pending' | 'complete' | 'failed' | null;
visualAudioNarrative?: string | null;
```

Below the existing `explanationSegments` block, render:
- Nothing, if `visualAudioStatus` is absent/null and the caller isn't subscribed (no dead button for a feature they can't use — the subscription check happens server-side regardless, this is just not showing an unusable control).
- A "See how your first 5 seconds actually look" button (subscribed, not yet requested) that calls `POST /api/diagnostic/[id]/enrich`, shows a loading state, then re-fetches the diagnostic.
- The rendered `visualAudioNarrative` in its own labeled block once `status === 'complete'`.
- A clear retry affordance if `status === 'failed'`.

No new page, no frame gallery, no per-frame UI — matches decision 4 (narrative only) and the existing Non-goals.

## 7. Error handling

- Unsupported platform (YouTube always, Instagram until its spike lands) → rejected with 422 *before* any status is written (§5 step 4) — never enters the `'pending'`/`'failed'` lifecycle at all.
- Video acquisition fails for a supported platform (Apify run fails, video too large/long) → `visual_audio_status: 'failed'`, specific message logged server-side, generic message to the client. Never affects the base diagnostic's own scores or status.
- Transcript unavailable → `transcript: null`, passed through to the prompt as "(not available for this video)"; Claude is instructed not to fabricate audio content it wasn't given.
- Zero frames extracted → treated as a failure, not silently returned as an empty/generic narrative.
- Claude response fails to parse as JSON, or is truncated (`stop_reason === 'max_tokens'`) → same failure path as the existing `requestClaudeJson` error handling (already thrown correctly by shared code, no new handling needed).
- The 60-second budget is real and can plausibly be tight (TikTok scrape+download alone has taken 10-30s in ad hoc testing; frame extraction and the Claude call add more on top) — no retry inside the request (Non-goals). If this proves too tight in practice post-launch, the fix is to shrink `HOOK_WINDOW_TIMESTAMPS_SECONDS` (e.g. back to 1-second sampling, 5 frames instead of 10) rather than trying to extend past the Hobby plan's real ceiling.

## 8. Testing plan

- Unit: `lib/integrations/frame-extractor.test.ts` — correct request shape (`videoUrls` as `{url}` objects, lowercase `outputFormat`), filters out non-`succeeded` frames, throws on non-2xx.
- Unit: `lib/integrations/claude-visual-audio.test.ts` — prompt assembly (image blocks in order, transcript-absent phrasing, Hook Strength context line present), parses `{"narrative": ...}`.
- Unit: `lib/integrations/scraper.test.ts` — new `fetchVideoForAnalysis` TikTok case (correct input shape, maps `mediaUrls`/`videoMeta`/`transcriptionLink`); Instagram/YouTube cases assert `PlatformNotSupportedError` is thrown (not implemented, not silently no-op'd).
- Unit: `lib/diagnostic/enrich-handler.test.ts` — 401/403/402/422 paths, zero-frames failure, happy path writes `status: 'complete'` with the narrative, any pipeline exception writes `status: 'failed'`.
- Component: `tests/unit/app/diagnostic/id-page.test.tsx` — new cases for the enrich button's three states (not shown when ungated, loading, complete, failed-with-retry).
- Migration test case appended to `tests/unit/supabase/migrations.test.ts` for the three new columns.
- Update `tests/fakes/scraper.fake.ts` with a fake `fetchVideoForAnalysis`; new fakes for `FrameExtractorClient` and `ClaudeVisualAudioClient`.
- **No automated test can validate the real Apify actors' actual behavior** (input schema quirks, real timing) — that was done empirically this session and is documented in §2/§3's code comments precisely so a future change to those actors' schemas is caught by a human noticing the comment no longer matches reality, not by a unit test (unit tests mock these calls, by design).
