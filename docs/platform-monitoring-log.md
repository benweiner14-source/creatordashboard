# Platform Feature-Change Monitoring Log

This log tracks changes to TikTok, YouTube Shorts, and Instagram Reels
that could make the Diagnostic feature's scoring stale — specifically,
anything affecting ranking/distribution, hook or retention behavior,
ideal video length, or posting-time patterns. Those are the inputs
`lib/diagnostic/hook-strength.ts`, `lib/diagnostic/retention-risk.ts`,
`lib/diagnostic/timing.ts`, and `lib/diagnostic/format-fit.ts` are
calibrated against (see
`docs/superpowers/specs/2026-08-13-diagnostic-benchmark-sources.md`
for where those original thresholds came from).

A scheduled Routine researches this monthly and appends an entry here
whenever it finds something that looks material. Runs that find
nothing worth flagging don't get an entry — this file is a record of
signal, not a run log.

## Entry format

```
## YYYY-MM-DD

**What changed:** <short description>
**Source(s):** <links>
**Affects scoring?** <yes/no/unclear, and which file(s) if yes>
**Recommendation:** <what to do about it, if anything>
```

## Entries

## 2026-08-13

**What changed:** Three related shifts turned up across all three platforms this cycle:

1. **Engagement signal reweighting.** TikTok now weights comments above likes, and shares/saves above likes (2025→2026 shift). Instagram's algorithm lead (Adam Mosseri) has confirmed watch time, sends-per-reach (DM shares), and saves as the top ranking signals — likes and follower count now carry "almost no weight." TikTok's completion-rate bar for reaching wider distribution is reported at ~70%, up from ~50% in 2024.
2. **Follower-first testing.** TikTok now tests new videos with a small audience of existing followers before showing them to non-followers, a change described as new for 2026.
3. **YouTube Shorts confirmed as a separate ranking engine from long-form YouTube**, with Shorts ranked on swipe-through rate, loop rate, and first-second engagement, while long-form is ranked on satisfaction, retention, and session contribution — explicitly *not* shared signals between the two.

**Source(s):**
- https://www.voqusa.com/en/blog/tiktok-algorithm-2026
- https://www.socialync.io/blog/tiktok-algorithm-2026-what-works-now
- https://about.instagram.com/blog/announcements/reels-algorithm-control
- https://www.socialpilot.co/blog/instagram-reels-algorithm
- https://www.socialync.io/blog/youtube-shorts-algorithm-2026
- https://outlierkit.com/resources/youtube-algorithm-updates/

Caveat: none of these are platform-official sources except the Instagram "About" blog link; the specific numbers (e.g. "70% completion bar", "almost no weight" for likes) come from third-party creator-marketing blogs interpreting platform behavior, not confirmed engineering specs. Treat as directional, not exact.

**Affects scoring?** Yes, in two ways:
- `lib/diagnostic/hook-strength.ts` and `lib/diagnostic/retention-risk.ts` both compute "engagement rate" as a flat `(likeCount + commentCount) / viewCount`, with no weighting between the two and no signal at all for shares/saves/sends. If comments and saves really do matter more than likes now (point 1 above), a post that's heavy on likes but light on comments/saves would currently score higher than the platforms would actually rank it — the direction of the bias runs the wrong way. Note the app doesn't currently collect share/save/send counts from either the YouTube API client or the Apify TikTok/Instagram scraper, so weighting them would require an integration change first, not just a scoring-formula change.
- `lib/diagnostic/retention-risk.ts` and `lib/diagnostic/format-fit.ts` both use a single `youtube` ideal-duration anchor (8 minutes for retention risk, 4–15 minutes for format fit) with no distinction between long-form YouTube and YouTube Shorts. Given point 3 above (Shorts and long-form are confirmed to be scored on genuinely different criteria), any YouTube Short submitted to the diagnostic today would be scored against long-form-video length/retention expectations, which would produce a systematically wrong report. This is likely to affect real users, since short vertical video is the primary format this app's target creators post.

**Recommendation:** Worth a scoped follow-up brainstorming session, not urgent/blocking. Two candidate follow-ups, in likely priority order:
1. Add a `youtube_shorts` (or duration-based) branch to `retention-risk.ts` and `format-fit.ts` so YouTube Shorts get Shorts-shaped ideals instead of long-form ones — this is a real correctness gap independent of whether these specific 2026 numbers hold up, and probably the more urgent fix.
2. Reconsider whether `hook-strength.ts`/`retention-risk.ts`'s engagement-rate formula should weight comments over likes, pending a decision on whether it's worth extending the YouTube/scraper integrations to collect share/save counts at all — lower priority since it requires new data collection, not just a formula change.

**Status:** Item 1 (YouTube Shorts vs. long-form) actioned the same day — see `docs/superpowers/specs/2026-08-13-diagnostic-benchmark-sources.md`'s "YouTube Shorts" section and the `isLikelyYouTubeShort` duration-based split in `lib/diagnostic/retention-risk.ts`/`format-fit.ts`. Item 2 (engagement-rate weighting) remains open — no code change yet, still pending a decision on whether to extend the integrations to collect share/save data.
