# Diagnostic Scoring Benchmark Sources

**Status:** Informed estimates, not verified ground truth. No real usage data exists yet (pre-launch). Revisit every number here once real diagnostic usage data exists to calibrate against, and whenever `lib/diagnostic/*.ts`'s thresholds are touched, update this file in the same change.

**Audience context:** target users are gaming creators (GTA/NBA 2K-adjacent content) under ~5,000 followers. No dedicated per-game benchmarks exist publicly (too narrow a slice for anyone to publish, and the diagnostic doesn't know which game a video is about anyway) — gaming-niche-level and small-account-tier data is the right granularity, and is used here in preference to generic cross-niche numbers.

**Data-availability constraint:** the app only collects view/like/comment counts + duration (via YouTube Data API v3 and Apify scraping) — no watch-time curves, shares, saves, or CTR/impression data. Every threshold below calibrates the app's `(likes+comments)/views` engagement-rate proxy and platform+duration comparisons against real research — it does not mean the app measures AVD/completion-rate/CTR directly.

## Confidence tiers

**Tier 1 — official platform statements** (named exec or official blog, directional not numeric):
- Instagram: Adam Mosseri (Head of Instagram) — watch time, likes, and shares are the primary Reels ranking signals.
- TikTok: TikTok Newsroom — finishing a video start-to-finish is "one of the strongest interest signals in the whole system."

**Tier 2 — established firms, disclosed methodology/sample size** (used for actual numeric thresholds):
- **vidIQ** (first-party channel data): their 2.39M-subscriber channel averages 30.3% average-percentage-viewed (APV) across 16.5M long-form views; their Shorts average 73.6% APV (trailing 12 months, June 2026). Source: vidIQ blog, "YouTube Average View Duration: What Is a Good AVD?" / "YouTube Audience Retention" (vidiq.com/blog).
- **Retention Rabbit** 2025 benchmark report, 10,000+ videos analyzed: platform-wide YouTube average retains 23.7% of viewers overall; only 16.8% of videos surpass 50% AVD; below 40% AVD is treated as a deprioritization signal by the algorithm. (Also cited, with the same figures, by the vendored `claude-youtube` skill's `algorithm-guide.md`.)
- **Sprout Social Index** (2026): TikTok ~3.2% avg engagement rate; Instagram ~1.62% overall, Reels specifically ~2.35%.
- **Hootsuite benchmarks** (2026): TikTok ~1.5% avg engagement rate; Instagram ~3.5% overall, Reels specifically ~2.8%.
- **Gaming-niche TikTok data**: gaming creators average 2.6% engagement (vs. TikTok's platform-wide average); accounts under 100K followers average 7.5% engagement vs. 2.88% for 10M+ accounts; gaming retention targets ~45%+ for highlight clips, ~35%+ for extended gameplay; ~1 comment per 30 views is the gaming-community norm.

**Known disagreement, not resolved:** Sprout Social and Hootsuite — both established firms with real published reports — disagree by roughly 2x on the same platforms (TikTok 3.2% vs 1.5%; Instagram 1.62% vs 3.5%), almost certainly from differing methodology (per-follower vs. per-view, which interaction types count, which industries are sampled). Going to bigger names did not resolve this; it only changed the disagreement from "unknown methodology" to "known-but-different methodology." Where used below, both are cited and an explicit choice is documented rather than presented as settled fact.

## Calibration decisions

### YouTube (`lib/diagnostic/retention-risk.ts`, `hook-strength.ts`)
- Ideal duration anchor: **480s (8 min)** — unchanged from the original estimate, now independently supported: YouTube "starts rewarding with higher suggested placement after minute 8" (youtuber-skills / MrBeast production research, `algorithm-2026` skill).
- Retention/AVD framing: 23.7% = platform average (Retention Rabbit), below 40% = deprioritization risk, 30%+ = a realistic "good" target for long-form (vidIQ's own channel benchmark).
- Hook-window framing: keep 60%+ of viewers past the 30-second mark; strongest hooks hold 65%+ (vidIQ).
- No sourced YouTube-specific engagement-rate (like+comment/view) percentage was found with disclosed methodology — CTR (the platform's real ranking-adjacent metric) requires impression data the public API doesn't expose. The existing generic engagement-rate proxy is kept for YouTube with its prior threshold, flagged here as the weakest-calibrated of the three platforms.

### TikTok (`retention-risk.ts`, `hook-strength.ts`)
- Ideal duration anchor: **30s** — unchanged, now independently supported (30s clips get the highest TikTok engagement rate; sits inside the 21-34s max-completion-rate range).
- Engagement-rate thresholds recalibrated to gaming + small-account reality: ~7.5% is the *average* for gaming accounts under 100K followers (our actual target cohort), not an exceptional score — raise the "strong" bar accordingly (from the previous flat 0.05) to roughly 0.08, "moderate" around 0.03-0.04.
- Hook-window framing: first 2 seconds decide 70%+ of retention; hooks in the first second get 41% higher retention; 63% of highest-CTR videos front-load their main message in the first 3 seconds.
- Retention targets: 45%+ for highlight-style clips, 35%+ for extended gameplay (gaming-specific).

### Instagram (`retention-risk.ts`, `hook-strength.ts`)
- Ideal duration anchor: adjusted from 30s toward **20s** — Reels between 7-15s get the highest retention (60-80%), but total watch time also matters (a 45s Reel at 70% retention can outperform a 15s Reel at 90% on total seconds watched), so 20s is a documented compromise, not a single clean number from one source.
- Engagement-rate thresholds recalibrated down from the previous flat 0.05 (which no realistic Instagram post would ever clear): using the average of Sprout Social's and Hootsuite's Reels-specific figures (2.35% + 2.8% ≈ 2.6%) as the "moderate" baseline, roughly 0.04 as "strong."
- Hook-window framing: most viewers decide within the first 3 seconds; a 50%+ drop-off in that window signals a weak hook (Mosseri-adjacent reporting).

## Sources
- vidIQ blog: https://vidiq.com/blog/post/average-view-duration/, https://vidiq.com/blog/post/increase-audience-retention-youtube/
- `claude-youtube` skill (MIT, AgriciDaniel): https://github.com/AgriciDaniel/claude-youtube — `references/algorithm-guide.md`
- `youtuber-skills` (MIT, ravsau): https://github.com/ravsau/youtuber-skills — `skills/algorithm-2026/SKILL.md`
- Sprout Social Index 2026 (via secondary citation — not fetched directly from sproutsocial.com)
- Hootsuite social media benchmarks 2026 (via secondary citation — not fetched directly from blog.hootsuite.com)
- Gaming-niche TikTok engagement data (via secondary citation, sources of unclear individual provenance — treated as directionally useful given consistency across the searches, not as a single authoritative report)
