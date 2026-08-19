# Dashboard Home Design Spec

**Date:** 2026-08-16
**Classification:** Architectural (per `brainstorming`) — a new route, a new shared nav component threaded across four existing pages, and two new small API routes. No new tables/columns; everything the page shows already exists in `profiles`, `diagnostics`, `recap_cards`, and `weekly_digests`.
**Status:** Approved for planning pending user review of this doc.
**Mockup reference:** [Creator Dashboard mockup](https://claude.ai/code/artifact/fb58bc4f-d8f9-4dd6-a35e-3b93a60524db) (static HTML, `/tmp/.../scratchpad/dashboard-home-mockup.html`) — visual direction is locked from this file; this spec translates it into real data and real app conventions.

## What this is

Today a signed-in creator has no central landing page — Diagnostic, Recap Card, and Weekly Content Ideas are three unrelated URLs (`/diagnostic`, `/recap`, `/ideas`) with no navigation between them and no shared identity chrome. `/home` becomes the landing view after sign-in: one page showing where each of the three tools currently stands (latest score, this month's recap, this week's ideas), with a persistent nav bar for moving between them. This is purely a new aggregation surface — none of the three tools' own pages or logic change.

## Decisions already made (inputs to this spec)

From the earlier `brainstorming` round (confirmed via `AskUserQuestion`):

1. New route, `/home` — not a rebuild of `/`.
2. Per-section behavior is "latest data if it exists, else a prompt to act":
   - Diagnostic → latest score if any diagnostic exists, else a prompt to run the first one.
   - Recap → this month's card if generated, else a prompt to generate it.
   - Ideas → this week's ideas if generated, else a prompt to set a niche / generate.
3. A shared nav bar (Home / Diagnostic / Recap / Ideas + identity + sign out) appears on all signed-in pages, not just `/home`.
4. Visual direction: light but more vibrant/playful, staying in the existing indigo/violet family used more boldly (not a new brand color).

From the mockup review (locked visual decisions, superseding the flatter first draft the user called "a budget version"):

5. A rounded "shell" container with layered shadow depth around the whole page, not a flat background — the mockup's `.shell` treatment.
6. A gradient hero banner ("Welcome back, {name}.") using a serif display font for the headline, system-ui for everything else.
7. Colored platform icon badges (YouTube red, TikTok black, Instagram gradient) wherever a card references a platform.
8. Real per-dimension ring/donut mini-charts on the Diagnostic card (hook, retention, timing, format).
9. A gradient CTA-styled card variant for whichever section(s) need a prompt-to-act, reusable across all three cards (the mockup only shows the Ideas card in this state, but the styling must generalize — Diagnostic and Recap hit the same empty state for a brand-new creator).

New decisions this spec makes (not previously discussed — flagged here for the review gate rather than decided silently):

10. **The mockup's Recap sparkline is not implemented as drawn.** It depicts a smooth week-by-week view trend, but `recap_cards` stores one aggregate total per month (`totals`, `platformData`, `topPost` — see `lib/recap/types.ts`) with no weekly time series anywhere in the schema. Drawing a trend line would mean inventing data points, which conflicts with `PRODUCT.md`'s Product Principle 5 ("Honest state, always: no fabricated data"). §7.2 replaces it with a per-platform view-share bar chart built from `platformData`, which *is* real and already computed. This still delivers genuine data-viz on that card, just from data that actually exists.
11. **`/` redirects a signed-in visitor to `/home`.** Landing on the marketing page while already signed in (e.g., a bookmark) is a dead end today; once `/home` exists it's the more useful destination. Small, low-risk addition — flagged for veto in review since it wasn't in the original decision set.
12. **A sign-out action is new.** No sign-out route exists anywhere in the app today (grepped — confirmed absent). The nav's identity chip needs one; it's a small, self-contained addition.
13. **Nav identity uses email, not `display_name`.** `profiles.display_name` exists in the schema but nothing in the app ever sets it (grepped — only referenced in the migration and generated types). Using it would show "null" or require silent fallback logic on every page; using the real, always-present `email` is simpler and honest.
14. **Implementation is Tailwind utility classes plus a couple of small presentational components, not a ported copy of the mockup's custom CSS.** Every existing page in this app is plain Tailwind utility classes with no custom stylesheet beyond the three `@tailwind` directives in `globals.css`. The mockup's hand-rolled `.shell`/`.card`/`.badge--yt` CSS is a static-artifact convenience, not a pattern to carry into the app — introducing a parallel styling system here would be inconsistent with every other page and harder for future work to extend. Gradients/shadows that need values Tailwind's default theme doesn't have use Tailwind's arbitrary-value syntax (`bg-[linear-gradient(...)]`), matching how one-off values are already handled elsewhere in this codebase (e.g., inline `style` on `SignInPrompt`/`Spinner` where needed).

## Non-goals

- No full diagnostic history/timeline on Home — latest score only; the complete history stays a `/diagnostic`-only concern (that page doesn't even list history today, so this doesn't regress anything).
- No editing niche/handles/platform connections from Home — Home is read-plus-link-through only; every edit affordance stays on its own tool's page.
- No live/real-time updates — Home reflects state as of page load, same as every other page in this app.
- No notifications or activity feed.
- No reordering or customizing the 3-card grid.
- No new mobile nav pattern beyond hiding the link row under 860px (matches the reviewed mockup) — a hamburger/drawer is a fast-follow if usage shows it's needed.
- No changes to how `/diagnostic`, `/recap`, or `/ideas` generate or store data — this spec only wraps them in shared nav and reads their existing tables for the Home summary.

---

## 1. Data model

No new tables or columns. Home reads three existing tables read-only:

- `diagnostics` — most recent row for the signed-in profile (`order by created_at desc limit 1`), any `status` (a `pending`/`failed` row still reflects "what happened last," and status is already surfaced via `report_json`/`error_message` if ever needed — but see §7.1, in practice this route only needs `complete` rows, since incomplete ones never reach the save step in `lib/diagnostic/handler.ts`).
- `recap_cards` — row for `(profile_id, month = current-month-key)`, same `currentMonthKey` shape `app/api/recap/route.ts` already uses.
- `weekly_digests` — row for `(profile_id, week_start = current-week-key)`, same `weekStartKey` helper `lib/ideas/handler.ts` already exports.
- `profiles.niche` — to distinguish "no niche set" from "niche set, nothing generated yet" on the Ideas card.
- `auth.getUser()` — for identity (email) and the 401 gate, same as every other authenticated route.

---

## 2. `GET /api/home`

New route, `app/api/home/route.ts`. Auth required (401 if signed out, matching every other route's shape). No POST — this route is read-only.

Follows the same convention as `GET /api/recap` and `GET /api/ideas`: the Supabase reads and row-mapping are inlined directly in `route.ts` (no dedicated `lib/home/handler.ts`) because, like those two routes, there's no branching business logic to unit-test in isolation — it's three independent lookups plus null-safe shaping. The one genuinely testable piece of logic (deriving a display name from an email, and a relative-date caption) is pulled into small pure helpers per §7.

```ts
// app/api/home/route.ts response shape

interface HomeResponse {
  email: string;
  diagnostic: {
    id: string;
    platform: 'youtube' | 'tiktok' | 'instagram';
    overallScore: number;
    hookStrengthScore: number;
    retentionRiskScore: number;
    timingScore: number;
    formatFitScore: number;
    createdAt: string; // ISO
  } | null;
  recap: {
    id: string;
    month: string;
    totals: PlatformTotals; // from lib/recap/types.ts, already exported
    platformData: Partial<Record<RecapPlatform, PlatformTotals>>;
    topPost: RecapTopPost | null;
    generatedAt: string; // ISO
  } | null;
  ideas: {
    niche: string | null;
    digest: {
      weekStart: string;
      ideaCount: number;
      firstIdeaTitle: string; // ideas[0].workingTitle — used as the card's teaser line
    } | null;
  };
}
```

`diagnostic`/`recap` are `null` when no row exists — that's the page's only signal for "show the prompt-to-act variant of this card." `ideas.digest` is `null` independently of `ideas.niche` so the card can distinguish "no niche yet" from "niche set, nothing generated this week" (two different prompts, per §7.3).

---

## 3. `GET /api/session`

New route, `app/api/session/route.ts`. Returns `{ email: string }` on success, 401 if signed out. This is the sole data dependency of `<AppNav>` (§5) — deliberately separate from `/api/home` so the same nav component works unmodified on `/diagnostic`, `/recap`, and `/ideas`, none of which otherwise have a reason to call `/api/home`.

This does mean `<AppNav>` fires one small extra request on every page it's mounted on, including `/home` (which technically already has the email from `/api/home`). That duplication is intentional: a single self-contained nav component with one fetch shape everywhere is simpler to build and safer to extend than threading an `identity` prop through four different pages' four different bootstrap payloads for the sake of saving one lightweight, cookie-authenticated request. Flagged here as a deliberate trade, not an oversight.

---

## 4. `POST /api/auth/sign-out`

New route, `app/api/auth/sign-out/route.ts`, mirroring the naming of the existing `app/api/auth/magic-link/route.ts`. Calls `createSupabaseServerClient()` then `supabase.auth.signOut()`, which clears the session cookie via the existing cookie-handling wired into `lib/supabase/server.ts`. Returns `{ ok: true }`. The client (nav's sign-out link) calls this then `router.push('/')`.

---

## 5. `<AppNav>` component

New file, `components/AppNav.tsx`. Self-contained: on mount, fetches `GET /api/session`; renders nothing at all until that resolves, and renders nothing (not an error state) if it 401s. This makes it safe to mount unconditionally, including on `/diagnostic`, which today deliberately lets an anonymous visitor type a URL before ever being asked to sign in (`lib/auth/sign-in-flow-state.ts`) — mounting `<AppNav>` there doesn't add friction or an upfront auth check to that flow; it just quietly appears if a session already exists and stays invisible otherwise.

No required props. Active-link highlighting is computed internally via `usePathname()` from `next/navigation` (already used elsewhere in the app via its sibling `useSearchParams`/`useRouter`) — matching against `/home`, `/diagnostic`, `/recap`, `/ideas`.

Renders, left to right: brand mark + "Creator Dashboard" (links to `/home`), the four nav links, an identity chip (avatar circle with the first letter of the email, uppercased, plus the email text) and a "Sign out" action that calls §4's route.

Mount points:
- `/home` — top of the page, always (page is signed-in-only already).
- `/diagnostic` — top of `DiagnosticInputPageInner`'s returned JSX, unconditionally (per the progressive-reveal behavior above).
- `/recap`, `/ideas` — inside the authenticated render branch only (below the existing `needsSignIn`/`checkEmail`/etc. early return), since those pages already know sign-in status by the time that branch renders and the sign-in-prompt screens shouldn't show a nav bar for tools the visitor hasn't unlocked yet.

---

## 6. `/home` page

New files: `app/api/home/route.ts` (§2), `app/home/page.tsx`.

Follows the same client-component-with-`useEffect`-bootstrap pattern as `/recap` and `/ideas` (this app has no server-component data-fetching pattern anywhere yet — staying consistent rather than introducing one for a single page):

- `loading` → simple `<p>Loading…</p>`, matching `/recap`/`/ideas`.
- `needsSignIn` (i.e. `GET /api/home` returns 401) → redirect to `/diagnostic` with a `authError` flag reusing the existing `SignInPrompt`-driven flow that page already has, OR simplest: redirect straight to `/` — since `/home` has no meaningful unauthenticated state of its own (unlike `/diagnostic`, which has content to show before sign-in). Redirect via `router.replace('/')`.
- Loaded → renders `<AppNav />`, the gradient hero (`"Welcome back, {displayName}."` where `displayName` is derived from `email` per §7.4, plus a static subline: `"Here's how your tools are looking this week."`), then the 3-card grid (§7).

---

## 7. The three cards

All three cards share one visual shell (a Tailwind-utility `Card` wrapper, plus a `Card` "cta" variant using the gradient/white-text treatment from the mockup) so any of the three can render in either state without one-off styling per section.

### 7.1 Diagnostic card

**Has data** (`diagnostic !== null`):
- Platform badge (colored icon, mapped from `diagnostic.platform` via a new small `<PlatformBadge platform="youtube" />` component covering all three platforms' real brand colors from the mockup: YouTube `#e5342a`, TikTok `#121212`, Instagram gradient `#f6a34d → #dd2a7b → #7b3fe4`) + "Latest diagnostic" title.
- Big stat: `overallScore/100`.
- Four `<ScoreRing>` mini-donuts (new small presentational component: takes `value: number, label: string, colorVar: 'accent' | 'accent-2'`, computes SVG `stroke-dasharray`/`stroke-dashoffset` from `value` — circumference for `r=18` is `2π·18 ≈ 113.1`, matching the mockup's hand-computed values exactly, just computed from real numbers instead of hardcoded) for `hookStrengthScore`, `retentionRiskScore`, `timingScore`, `formatFitScore`.
- Caption: `"Checked {relative(createdAt)}"` via a new pure `formatRelativeDays(from: Date, now: Date): string` helper (`"today"` / `"N days ago"` / `"N weeks ago"`), unit-tested directly — this is the one piece of date-formatting logic on this page worth a real test rather than inline `Intl` calls scattered around.
- Footer link: `"Run another →"` → `/diagnostic`.

**No data** (`diagnostic === null`): CTA-variant card. Heading: `"Run your first diagnostic"`. Body: `"Paste a link and get a plain-English breakdown of your hook, retention, timing, and format — takes under a minute."` Button: `"Run a diagnostic"` → `/diagnostic`.

### 7.2 Recap card

**Has data** (`recap !== null`):
- Badges: one `<PlatformBadge>` per key present in `recap.platformData`, in a fixed `youtube, tiktok, instagram` order for layout stability (mockup shows 2 overlapping badges for exactly this reason). Title: `"{Month name} recap"` derived from `recap.month`.
- Big stat: `totals.views` formatted compactly (`142000` → `"142K"`) via a new pure `formatCompactNumber(n: number): string` helper (unit-tested: `999 → "999"`, `1500 → "1.5K"`, `1_200_000 → "1.2M"`).
- **Replaces the mockup's sparkline** with a per-platform view-share bar list: one horizontal bar per entry in `platformData`, width proportional to that platform's `views` against `totals.views`, labeled with the platform name and its view count. Real data, no invented time series (§ new-decision 10 above).
- Line: `"Top post: "{topPost.captionOrTitle}" · {formatCompactNumber(topPost.viewCount)} views"` (omitted entirely if `topPost` is `null` — possible in principle if every connected platform returned zero posts, though `lib/recap/aggregate.ts` today only sets `topPost` from posts that exist).
- Caption: `"Updated {shortDate(generatedAt)}"` (e.g. `"Aug 1"`) via `Intl.DateTimeFormat` inline — this one doesn't need a dedicated pure helper since it's a single direct `Intl` call with no branching, unlike `formatRelativeDays`.
- Footer link: `"View full recap →"` → `/recap`.

**No data** (`recap === null`): CTA-variant card. Heading: `"Generate this month's recap"`. Body: `"Connect a platform once, then get a shareable card of this month's stats."` Button: `"Get my recap"` → `/recap`.

### 7.3 Ideas card

Three states, not two — the extra state comes from §2's `ideas.niche`/`ideas.digest` being independently nullable:

**Has this week's ideas** (`ideas.digest !== null`): matches the has-data pattern above even though the mockup's example didn't show this state — badge: the same idea/sparkle icon the mockup uses for the CTA variant, rendered in the indigo-on-white treatment instead of white-on-gradient. Title: `"This week's ideas"`. Body line: `ideas.digest.firstIdeaTitle`, plus `"+{ideaCount - 1} more"` if `ideaCount > 1`. Footer link: `"View all ideas →"` → `/ideas`.

**Niche set, nothing generated this week** (`ideas.niche !== null && ideas.digest === null`): CTA-variant card. Heading: `"Get this week's ideas"`. Body: `"We'll research what's trending for {niche} right now."` Button: `"Get my ideas"` → `/ideas`.

**No niche set** (`ideas.niche === null`): CTA-variant card, exactly matching the mockup's example. Heading: `"Set your niche to get this week's ideas"`. Body: `"Takes 10 seconds — we'll research what's trending for you every Monday."` Button: `"Set my niche"` → `/ideas`.

### 7.4 Shared helpers

- `deriveDisplayNameFromEmail(email: string): string` — new pure helper, `lib/home/display-name.ts`: takes the substring before `@`, uppercases the first character, returns the rest unchanged (`"jordan.reyes@gmail.com"` → `"Jordan.reyes"`). Unit-tested directly. Used only for the hero's `"Welcome back, {name}."` line — the nav's identity chip shows the full email, unmodified, so a creator can always tell exactly which account they're signed into.
- `formatRelativeDays`, `formatCompactNumber` — as described above, both in `lib/home/format.ts`, both pure and unit-tested.

---

## 8. Visual design tokens

Carried over from the reviewed mockup, expressed as Tailwind arbitrary values / a minimal `tailwind.config.ts` extension rather than CSS custom properties (per new-decision 14):

- Page background: soft indigo wash — `bg-[#e7e2f6]` with a radial gradient overlay via arbitrary-value `bg-[radial-gradient(1100px_480px_at_12%_-10%,#ece7fa,transparent_60%)]` composited under it (two stacked background layers, same visual as the mockup's `body` rule).
- Shell: white/near-white rounded container (`rounded-[28px] bg-[#fdfcff]`) with the mockup's layered shadow, added to `tailwind.config.ts` as a named `boxShadow.shell` value so it isn't a one-off arbitrary string repeated at every call site.
- Hero gradient: `bg-[linear-gradient(120deg,#4338ca_0%,#6229c9_46%,#9333ea_100%)]` — the same indigo→purple sweep already used for `bg-indigo-600`/existing button treatments, just applied as a gradient instead of a flat fill.
- Display font (hero heading, CTA card headings): a serif stack added as `fontFamily.display` in `tailwind.config.ts` (`Georgia, "Iowan Old Style", "Palatino Linotype", "Book Antiqua", serif`, matching the mockup exactly) — applied via a new `font-display` utility class. Body text stays the existing default system-ui stack; no change to `globals.css`.
- Platform badge colors — YouTube `#e5342a`, TikTok `#121212`, Instagram `linear-gradient(135deg,#f6a34d_0%,#dd2a7b_55%,#7b3fe4_100%)` — hardcoded inside `<PlatformBadge>` (§7.1), not exposed as reusable tokens, since nothing else in the app needs them.
- `prefers-reduced-motion` respected on the hero/card entrance animation (a simple opacity+translateY rise, matching the mockup's `.reveal` treatment), implemented as a Tailwind `animate-*` utility guarded the same way — Tailwind's `motion-safe:`/`motion-reduce:` variants handle this natively without extra JS.

---

## 9. `/` redirect

`app/page.tsx` becomes an async server component (it has no client interactivity today, so this is a safe conversion): calls `createSupabaseServerClient()` → `auth.getUser()`; if signed in, `redirect('/home')` (from `next/navigation`); otherwise renders the existing marketing content unchanged. Flagged in new-decision 11 for explicit review — everything else in this spec is additive, but this one changes existing behavior for signed-in visitors to `/`.

---

## 10. Testing

Matching this app's established conventions — pure logic unit-tested with real assertions, page bootstraps covered by one Playwright smoke test with the network mocked, no dedicated tests for trivial GET-route row-mapping (same precedent as `GET /api/recap`/`GET /api/ideas`):

- `lib/home/display-name.test.ts` — `deriveDisplayNameFromEmail`: capitalizes correctly, handles a single-character local part, handles a local part that's already capitalized.
- `lib/home/format.test.ts` — `formatRelativeDays`: today/yesterday/N days/N weeks boundaries; `formatCompactNumber`: under-1000 passthrough, K rounding, M rounding.
- `components/PlatformBadge.test.tsx` — renders the right color/icon per platform.
- `components/ScoreRing.test.tsx` — computed `stroke-dashoffset` matches expected values at 0/50/100.
- `components/AppNav.test.tsx` — renders nothing while the session fetch is pending and after a 401; renders identity + links once signed in; highlights the correct link per mocked `usePathname()`.
- `app/home/page.test.tsx` — each card renders its data variant when `GET /api/home` returns data, and its CTA variant when a section is `null`; ideas card's three-state branch specifically (niche null / niche set+no digest / digest present) gets its own three assertions.
- One extended/new Playwright case: `tests/e2e/home-smoke.spec.ts` — mocked `/api/home` and `/api/session`, asserts all three cards render, nav links are present, and clicking through to `/diagnostic` works.

No test coverage needed for the `/` → `/home` redirect beyond a direct assertion in `app/page.test.tsx` (mock `auth.getUser()` signed-in vs. signed-out, assert `redirect` was/wasn't called) — this is exactly the kind of server-component branch this app doesn't have a precedent for yet, so it gets its own small test rather than being folded into the Playwright suite.

---

## Self-review

**Scope check:** everything here is additive except §9 (the `/` redirect), which is called out explicitly as a new decision rather than folded in silently. No existing route, handler, or page-state reducer is modified — `/diagnostic`, `/recap`, `/ideas` each gain exactly one `<AppNav />` mount point and nothing else.

**No fabricated data:** every stat traced back to a real column or a real pure transform of one; the one place the mockup implied data that doesn't exist (Recap's sparkline) is explicitly replaced, not silently kept.

**Consistency with existing conventions confirmed by reading the actual code, not assumed:** GET-route inlining (matches `/api/recap`, `/api/ideas`), DI/pure-handler pattern only where there's real branching logic to test, Tailwind-utility-only styling (no CSS files exist beyond the three `@tailwind` directives), `'use client'` + `useEffect` bootstrap pattern (no server-data-fetching precedent except the one this spec adds at `/`), `usePathname`/`useRouter`/`useSearchParams` already used from `next/navigation` elsewhere.
