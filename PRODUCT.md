# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Creators with under 5,000 followers who are new to analytics — early-stage,
self-managed creators without the budget, scale, or expertise to use
enterprise-grade analytics tools built for established creators and
agencies.

## Product Purpose

Creator Dashboard helps small creators understand and improve their content
without needing to already understand analytics. Six tools: a free
Diagnostic that scores a single video/post (hook strength, retention risk,
timing, format fit, reach) and explains the score in plain language; a
monthly Recap Card summarizing a creator's platform performance; a Weekly
Content Ideas digest of AI-researched, niche-specific content concepts; a
Strategy Breakdown that analyzes any channel's posting cadence and format
mix; a Competitor Watchlist that tracks up to 20 competitor
channels/profiles over time; and the GTA6 War Room, a real-time feed of
GTA6 content opportunities (the product's only real-time surface — every
other tool is weekly or on-demand).

## Positioning

Built and scoped specifically for creators under 5,000 followers — not a
scaled-down version of an enterprise analytics tool, but a product whose
target user, cost, and complexity assume a beginner from the start. The
plain-English explanation of *why* a score is what it is (not just the
number) is core to this, not a secondary nicety.

The product has since narrowed its niche focus to GTA6 content creators
specifically — Weekly Content Ideas, the GTA6 War Room, and the Diagnostic's
research-backed copy are all now scoped to that niche rather than treating
"niche" as a fully generic input.

## Operating Context

A signed-in web app (Supabase magic-link auth, no password). Creators
connect their content via YouTube (public API, no OAuth needed), and via
OAuth for TikTok/Instagram (falling back to Apify-scraped public profile
data for a platform they haven't connected). Weekly Content Ideas can be
delivered proactively via a Monday email a creator opts into, not just
generated on-demand.

## Capabilities and Constraints

- Diagnostic: scores a single video/post across five dimensions (hook
  strength, retention risk, timing, format fit, reach); YouTube, TikTok, and
  Instagram supported; free, rate-limited to 1 run per profile per 30 days.
  Two opt-in, paid, per-diagnostic add-on passes: Visual & Audio Content
  Analysis (TikTok only — downloads the video, analyzes the first 5
  seconds' hook visually, and detects episodic/series framing) and Comment
  Analysis (TikTok and Instagram — reads a post's top comments for
  audience sentiment and flags concrete content requests).
- Recap Card: a monthly, shareable summary card of a creator's platform
  stats; publicly viewable at a share URL once generated. Requires a
  subscription.
- Weekly Content Ideas: a ranked shortlist of Reel/carousel concepts for
  the creator's chosen GTA6 focus (picked from preset chips, up to 3, plus
  an "Other" option), AI-researched against real current GTA6 news;
  regenerable weekly; optional automated Monday email delivery with
  one-click unsubscribe. Requires a subscription.
- Strategy Breakdown: paste any channel/profile link (YouTube, TikTok, or
  Instagram) and get its posting cadence, format mix, and a plain-English
  read on what's working and why — including channels the creator doesn't
  own. Requires a subscription.
- Competitor Watchlist: a saved, recurring version of Strategy Breakdown —
  track up to 20 competitor channels/profiles over time (follower/view/video
  counts plus current top 5 posts by views-per-hour). Requires a
  subscription.
- GTA6 War Room: a real-time feed that scrapes and scores GTA6 content
  platform-wide for virality, surfacing a creator's next content
  opportunity as it happens — the product's only real-time surface;
  everything else is weekly or on-demand. Requires a subscription.
- Diagnostic is free; every other tool requires the same $10/mo
  subscription (Stripe Checkout + Customer Portal).
- Web only — no native apps.

## Brand Commitments

- Product name: "Creator Dashboard."
- Visual accent color: indigo/violet, used consistently across every
  existing page.
- Voice: plain English, explicitly non-jargon — stated directly in existing
  product copy ("explained in words you actually understand, not jargon").

## Evidence on Hand

None yet. Pre-launch — no real users, testimonials, case studies, or press
exist. Future work must not fabricate any of these.

## Product Principles

1. Beginner-first: assume the user is new to analytics, not an expert
   skimming for the one metric they need.
2. Explain, don't just report: a score or stat is accompanied by what it
   means and why, not shown bare.
3. Low barrier to entry: free to start, minimal setup (a public handle or a
   quick OAuth connect), no complex configuration.
4. Actionable over exhaustive: each tool ends in a clear next step (run
   another diagnostic, view the recap, generate ideas), not a data dump.
5. Honest state, always: no fabricated data, testimonials, or claims —
   every page reflects real product state, including pre-launch.
