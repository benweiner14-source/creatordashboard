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

## 2026-09-01

**What changed:** Instagram Reels up to 3 minutes (180s) are now confirmed eligible for Explore-page / non-follower algorithmic distribution — wider than the shorter cap in effect when this app's Instagram duration ranges were originally calibrated (see the 2026-08-13 entry and the original benchmark doc). Several independent creator-marketing sources describe this consistently: content beyond 3 minutes still doesn't reach non-followers via discovery, but everything up to 3 minutes now competes on equal footing, with completion rate remaining the deciding factor for how far any given Reel actually travels. One source additionally claims Instagram now allows Reels up to 20 minutes for "eligible accounts," with materially reduced distribution beyond the 3-minute mark — treated here as an unconfirmed edge case, not a scoring input.

Also surfaced this cycle but judged not independently actionable: TikTok's US feed is reportedly now served by an Oracle-retrained, US-only ranking model (a data-localization/infrastructure change tied to the TikTok divestiture, not a scoring-relevant behavior change); and conflicting claims about whether YouTube Shorts ranks primarily on swipe-through rate vs. watch-time-per-impression (sources disagree with each other and with the swipe/loop/first-second-engagement framing already logged on 2026-08-13) — too unconfirmed and contradictory to act on this cycle.

**Source(s):**
- https://www.socialnewsdesk.com/blog/instagram-now-recommends-longer-reels-in-explore-what-creators-need-to-know/
- https://www.tryordinal.com/blog/how-long-can-an-instagram-reel-be
- https://www.socialcal.app/blog/instagram-video-length-limits-2026
- https://www.highstyle.ai/insights/instagram-reels-algorithm-2026

Caveat: none of these are Instagram-official sources — no About/Instagram-blog corroboration turned up this cycle, unlike the "sends-per-reach" claim logged on 2026-08-13, which did have one. Third-party creator-marketing blogs only; treat as directional, not confirmed.

**Affects scoring?** Yes — `lib/diagnostic/format-fit.ts`'s Instagram ideal range (`{ minSeconds: 15, maxSeconds: 90 }`) caps out well below the ~180s Explore-eligibility ceiling described above. A Reel in the 90–180s range would currently be scored as "too long" by this app even though it's reportedly now fully eligible for algorithmic distribution to non-followers. `lib/diagnostic/retention-risk.ts`'s Instagram ideal duration (20s) is unaffected — that number is about per-video completion-rate optimization, not distribution eligibility, and nothing found this cycle contradicts "shorter completes better."

**Recommendation:** Worth a small, scoped fix rather than a full brainstorming session — a single-file range change with a clear source basis, similar in shape to the 2026-08-13 YouTube Shorts fix. Widen `format-fit.ts`'s Instagram `maxSeconds` from 90 to somewhere in the 150–180s range (leave `minSeconds` at 15), citing this entry in a code comment. Given the "completion rate still decides" caveat above, keep this to a range widening only — don't touch `retention-risk.ts`'s 20s ideal, which answers a different question (retention optimality, not eligibility). Not urgent/blocking.

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

**Status:** Item 1 (YouTube Shorts vs. long-form) actioned the same day — see `docs/superpowers/specs/2026-08-13-diagnostic-benchmark-sources.md`'s "YouTube Shorts" section and the `isLikelyYouTubeShort` duration-based split in `lib/diagnostic/retention-risk.ts`/`format-fit.ts`.

Item 2 (engagement-rate weighting) also actioned the same day, scoped narrowly after further investigation: TikTok's "comments over likes" signal is now applied via `computeEngagementRate` in `lib/diagnostic/types.ts` (2x weight on comments, TikTok only, clearly labeled as an estimate — see the benchmark doc's TikTok section). Instagram's part of this finding ("sends/saves over likes") was investigated and found *not* actionable with current data: Instagram doesn't publicly expose share/save counts, so there's no way to approximate that signal through scraping — see the benchmark doc's Instagram section for why comment-weighting wasn't applied there instead. No integration changes were made; extending the TikTok scraper to collect a real share count (if the Apify actor exposes one) remains a separate, unverified follow-up, not done here.

**Follow-up closed (2026-08-13, later the same day):** a spike against Apify's own `clockworks/tiktok-scraper` actor page confirmed it does expose `shareCount` and `collectCount` (saves). `lib/integrations/scraper.ts` now maps both, and `hook-strength.ts` applies a small flat bonus when they're disproportionately high relative to likes — see the benchmark doc's "Share/save distribution bonus" entry for why this is a separate, capped bonus rather than folded into the core engagement-rate formula the comment weight uses.
