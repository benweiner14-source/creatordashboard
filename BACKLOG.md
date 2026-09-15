# Backlog

Ideas that have been scoped or discussed but deliberately not built yet.
This file exists so they don't get lost or re-litigated from scratch —
not a commitment to build any of them.

## Shelved: remaining ideas from the VidIQ competitive research pass

Source: a competitive research pass on vidiq.com (and a brief look at
LightReel, which was dismissed as B2B/agency tooling with nothing worth
adopting). That pass produced four ranked ideas; #1 and #2 have since
shipped. Shelving #3 and #4 for now — GTA6-niche MVP work (Content Ideas,
Recap Card, Strategy Breakdown, Competitor Watchlist, War Room) takes
priority, and simplifying the v1 surface area was an explicit decision,
not an oversight.

1. ~~**Competitor Watchlist**~~ — shipped. Track up to 20 competitor
   channels/profiles across YouTube/TikTok/Instagram with stat deltas and
   top-5-posts-by-views-per-hour.
2. ~~**VPH-normalized "top posts" elsewhere in the app**~~ — shipped.
   `computeViewsPerHour` (`lib/metrics.ts`) now ranks "best post" the same
   way across Watchlist, Recap Card, Strategy Breakdown, and War Room's
   severity scoring, instead of raw view count.
3. **A composite "Channel Health Score"** — not built. Bigger lift than
   the other two, but real shareability upside (VidIQ and TubeBuddy both
   use a single score as their hook; Recap Card already proved
   shareable-stat-cards work for this audience). Would roll up hook
   strength, retention risk, cadence, and format fit into one number with
   a plain-English "why" — a persistent, always-current version of what
   Diagnostic does per-post, but for the whole channel. The most
   product-shaped of the remaining ideas; worth its own brainstorming
   session (design decisions: what rolls into the score, how it's
   weighted, whether/how it interacts with the now-shelved Diagnostic)
   rather than a quick add.
4. **Best-time-to-post** — not built. Cheapest of the four.
   `lib/strategy/aggregate.ts` already computes cadence
   (`mostCommonDayOfWeek`, posts/week); extending that into an actual
   "post at X on Tuesdays" recommendation would be a small aggregation
   change, not a new subsystem.

**Explicit non-recommendation, not a backlog item:** VidIQ's per-action
AI-credit pricing model. Considered and rejected — it cuts against this
product's beginner-first, flat-$10/mo positioning. Recorded here only so
it isn't re-proposed without knowing it was already weighed.
