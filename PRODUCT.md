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
without needing to already understand analytics. Three tools: a free
Diagnostic that scores a single video/post (hook strength, retention risk,
timing, format fit) and explains the score in plain language; a monthly
Recap Card summarizing a creator's platform performance; and a Weekly
Content Ideas digest of AI-researched, niche-specific content concepts,
deliverable by email.

## Positioning

Built and scoped specifically for creators under 5,000 followers — not a
scaled-down version of an enterprise analytics tool, but a product whose
target user, cost, and complexity assume a beginner from the start. The
plain-English explanation of *why* a score is what it is (not just the
number) is core to this, not a secondary nicety.

## Operating Context

A signed-in web app (Supabase magic-link auth, no password). Creators
connect their content via YouTube (public API, no OAuth needed), and via
OAuth for TikTok/Instagram (falling back to Apify-scraped public profile
data for a platform they haven't connected). Diagnostic runs are
rate-limited (free tier: 1 per 30 days). Weekly Content Ideas can be
delivered proactively via a Monday email a creator opts into, not just
generated on-demand.

## Capabilities and Constraints

- Diagnostic: scores a single video/post across four dimensions (hook
  strength, retention risk, timing, format fit); YouTube, TikTok, and
  Instagram supported.
- Recap Card: a monthly, shareable summary card of a creator's platform
  stats; publicly viewable at a share URL once generated.
- Weekly Content Ideas: niche-based, AI-researched (web search) concept
  list, regenerable weekly; optional automated Monday email delivery with
  one-click unsubscribe.
- No billing or paid tier exists yet — everything is currently free.
- Web only — no native apps.

## Brand Commitments

- Product name: "Creator Dashboard."
- Visual accent color: indigo/violet, used consistently across every
  existing page (sign-in, diagnostic, recap, ideas).
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
