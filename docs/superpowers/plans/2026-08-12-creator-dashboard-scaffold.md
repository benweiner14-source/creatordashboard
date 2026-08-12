# Creator Dashboard — Scaffold Implementation Plan

## Context

The repo (`benweiner14-source/creatordashboard`, branch `claude/repo-setup-1yyjnv`) is currently just a README plus a vendored `.claude/skills/` directory — nothing has been built yet. The product brief (discovery-stage) calls for a $10/mo tool for creators under ~5,000 followers who don't yet know analytics concepts like "retention" or "hook rate," differentiated by a mandatory built-in education layer (an inline glossary woven into every report, not a separate help page).

Earlier in this conversation, three architectural decisions were made with the human partner and are treated as settled inputs to this plan, not open questions:
- **V1 feature scope:** Diagnostic (paste a link → plain-English report) + Recap Card (shareable monthly stats) + Weekly Content Ideas (recurring digest).
- **Validation path:** Diagnostic-only first — no Stripe, no paid tier, no password accounts. A lightweight Supabase magic-link identity is still needed, because the brief calls the free-tier abuse gate "the only uncapped cost line" and says it "needs a real gate before launch, not after."
- **Stack:** Next.js (App Router, TypeScript) + Supabase (Postgres/Auth/Storage) + Vercel, Tailwind CSS.
- **Hard constraint:** do not touch the Supabase/Vercel accounts already connected to this session's MCP tools — those are the user's existing accounts; this project gets its own, separate account later. This plan only writes code, config, and SQL migration *files* targeting Supabase/Vercel via environment variables — no live provisioning, no `mcp__Supabase__*` / `mcp__Vercel__*` calls, no deploys.

**Scope decomposition:** per the vendored `writing-plans` skill's Scope Check ("a spec covering multiple independent subsystems should be split into separate plans, each producing independently working/testable software"), this plan covers only: project scaffold, shared infrastructure (schema for all three v1 features, Supabase clients, glossary, rate limiting), the three external-integration interfaces, and the Diagnostic feature end-to-end. **Recap Card and Weekly Content Ideas are explicitly out of scope here** — they get their own follow-up plans once this one ships; the DB schema below already accommodates them so they aren't blocked later.

## Skills used from `obra/superpowers` (vendored at `.claude/skills/`)

- **`using-superpowers`** — the entry-point rule that any applicable skill must be invoked, which is why this task went through brainstorming before scaffolding rather than jumping straight to code.
- **`brainstorming`** — classified this as an Architectural task (new project); ran the condensed context → clarifying questions → design → approval flow already completed earlier in this conversation (feature-scope, validation-path, and stack decisions via `AskUserQuestion`).
- **`writing-plans`** — governs the plan you're reading now: the required document header, the `File Structure` section, the per-task template (Files / Interfaces / numbered TDD steps / commit), the "No Placeholders" rule, and the type-consistency self-review below.
- **`test-driven-development`** — every task below follows its RED → verify-fail → GREEN → verify-pass → refactor cycle; no production code is written before a failing test exists for it (Tasks 1–2 are the plan's one documented exception, since no test runner exists until Task 2 completes).
- **`subagent-driven-development`** (recommended execution path) — fresh implementer subagent per task, task-level review after each, one final whole-branch review; this is the mechanism that will actually work through the 28 tasks once this plan is approved.
- **`executing-plans`** — the alternative, inline-in-session execution path with batch checkpoints, offered at hand-off time.
- **`using-git-worktrees`** — provides the isolated workspace `subagent-driven-development` sets up before dispatching implementers.
- **`requesting-code-review`** / **`receiving-code-review`** — govern the task-level and final whole-branch reviews baked into the subagent-driven-development flow.
- **`systematic-debugging`** — on standby for any test failure or unexpected behavior hit during execution.
- **`verification-before-completion`** — the standard this plan's own "Verification" section (bottom) is written to meet: nothing gets called done without running commands and reading their output.
- **`finishing-a-development-branch`** — invoked once all 28 tasks are complete and reviewed, to decide how the branch gets integrated.

Not used for this plan: `dispatching-parallel-agents` (this plan's tasks are sequential/dependent, not independent parallel work) and `writing-skills` (no new skill is being authored).

---

# Creator Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the Creator Dashboard Next.js/Supabase project and build the shared infrastructure (schema, glossary, rate limiting, integration interfaces) plus a fully working Diagnostic feature end to end.

**Architecture:** A Next.js (App Router, TypeScript) app backed by Supabase (Postgres, Auth) and deployed to Vercel, with all external services (YouTube, TikTok/IG scraping, Claude) abstracted behind swappable typed client interfaces. The diagnostic scoring engine is a set of pure functions composed by a report-generation layer that calls the Claude client and links glossary terms into the output; a rate-limit gate sits in front of the one API route that spends money.

**Tech Stack:** Next.js 14 (App Router) + TypeScript + Tailwind CSS, Supabase (`@supabase/supabase-js`, `@supabase/ssr`), Vitest + Testing Library (unit/integration), Playwright (E2E), npm.

**Spec:** No separate spec doc exists in-repo for this plan. The approved product brief and the human-approved decisions (V1 feature scope, validation path, stack, integration-abstraction requirement, scoring/glossary/rate-limit mandates, and this plan's scope decomposition) are captured in the Global Constraints section below, distilled from the conversation preceding this plan.

## Global Constraints

- Do NOT provision any real Supabase or Vercel resources; do NOT call any `mcp__Supabase__*` or `mcp__Vercel__*` tools. Only write files (code, config, SQL migrations) that target them via environment variables.
- Everything must build, typecheck, and test successfully purely locally — no live database or external API connection required.
- Stack: Next.js (App Router, TypeScript) + Supabase (Postgres, Auth, Storage) + Vercel (hosting) + Tailwind CSS. Package manager: npm. Test runners: Vitest (unit/integration), Playwright (E2E, network mocked).
- Validation path is diagnostic-only: NO Stripe, NO paid tier, NO password-based accounts. Identity is Supabase magic-link email auth only.
- All external integrations (YouTube, TikTok/IG scraper, Claude) must be abstracted behind swappable typed interfaces with real implementations and fakes for testing — no API key required to build or test.
- The scoring engine (`lib/diagnostic/`) must be pure, fully unit-testable functions with no external dependencies, built via TDD.
- The glossary system must be a real, working feature (seeded `glossary_terms` table + `lib/glossary.ts` + inline `GlossaryChip`/`GlossaryText` UI), not a stub.
- Rate limiting (`lib/rate-limit.ts`) must be real, working logic — 1 free diagnostic per profile per rolling 30 days, enforced server-side before any external/paid API call, keyed off the Supabase profile plus an IP-hash secondary layer.
- The database schema must accommodate all three v1 features (Diagnostic, Recap Card, Weekly Content Ideas) even though only Diagnostic is built out here; do not build Recap Card or Weekly Content Ideas UI/logic in this plan.
- Every generated diagnostic report must explain "why" for each score, enforced via the Claude system prompt.

---

## File Structure

```
package.json                          # scripts, deps (npm)
tsconfig.json                         # TS config, "@/*" path alias
next.config.mjs                       # Next.js config (minimal)
next-env.d.ts                         # Next.js TS ambient types
tailwind.config.ts                    # Tailwind content globs
postcss.config.mjs                    # Tailwind/autoprefixer wiring
.eslintrc.json                        # next/core-web-vitals
.gitignore                            # node_modules, .next, .env*, etc.
vitest.config.ts                      # jsdom env, "@/*" alias, setup file
playwright.config.ts                  # E2E config, dev server, chromium
.env.example                          # documents every required env var
README.md                             # dev setup + "connect real Supabase/Vercel" note

docs/superpowers/README.md            # explains docs/superpowers/ convention
docs/superpowers/plans/.gitkeep       # plans/ dir placeholder

supabase/migrations/
  20260812000001_create_profiles.sql
  20260812000002_create_diagnostics.sql
  20260812000003_create_rate_limit_events.sql
  20260812000004_create_glossary_terms.sql
  20260812000005_create_weekly_digests.sql
  20260812000006_create_niche_community_sources.sql

lib/
  constants.ts                        # APP_NAME (also validates path alias)
  supabase/
    types.ts                          # hand-written Database type (matches migrations)
    browser.ts                        # createSupabaseBrowserClient()
    server.ts                         # createSupabaseServerClient(), createSupabaseServiceRoleClient()
    rate-limit-store.ts               # createSupabaseRateLimitStore(supabase) — RateLimitStore adapter
  glossary.ts                         # GlossaryTerm, GLOSSARY_TERMS, getGlossaryTerms, findGlossaryTermBySlug, linkGlossaryTerms
  rate-limit.ts                       # RateLimitStore, checkRateLimit, recordRateLimitEvent, hashIp (pure, no Supabase dep)
  integrations/
    youtube.ts                        # VideoMetadata, YouTubeClient, extractYouTubeVideoId, createYouTubeClient
    scraper.ts                        # SocialPostMetadata, ScraperClient, detectSocialPlatform, createApifyScraperClient
    claude.ts                         # ReportGenerationInput, GeneratedReport, ClaudeReportClient, DIAGNOSTIC_SYSTEM_PROMPT, createClaudeReportClient
  diagnostic/
    types.ts                          # ScoreLabel, ScoreResult, labelForScore (shared by all scorers)
    hook-strength.ts                  # HookStrengthInput, scoreHookStrength
    retention-risk.ts                 # RetentionRiskInput, scoreRetentionRisk
    timing.ts                         # TimingInput, scoreTiming
    format-fit.ts                     # FormatFitInput, scoreFormatFit
    score.ts                          # CombinedScoreInput, CombinedScore, combineScores
    report.ts                         # DiagnosticPostStats, DiagnosticReport, generateDiagnosticReport (glue)
    handler.ts                        # DiagnosticHandlerDeps, DiagnosticRequestContext, handleDiagnosticRequest (pure, testable route logic)

components/
  GlossaryChip.tsx                    # GlossaryChip, GlossaryText

app/
  layout.tsx                          # root layout, imports globals.css
  globals.css                         # tailwind directives
  page.tsx                            # `/` landing page
  diagnostic/
    page.tsx                          # `/diagnostic` — paste-a-link form
    [id]/
      page.tsx                        # `/diagnostic/[id]` — client-side report view
  api/
    diagnostic/
      route.ts                        # POST /api/diagnostic — wires real deps into handleDiagnosticRequest
      [id]/
        route.ts                      # GET /api/diagnostic/[id] — fetches saved diagnostic row

tests/
  setup.ts                            # imports @testing-library/jest-dom/vitest
  fakes/
    rate-limit-store.fake.ts          # createInMemoryRateLimitStore(): RateLimitStore
    supabase-query-builder.fake.ts    # createFakeSupabaseClient(): minimal chainable fake
    youtube.fake.ts                   # createFakeYouTubeClient(): YouTubeClient
    scraper.fake.ts                   # createFakeScraperClient(): ScraperClient
    claude.fake.ts                    # createFakeClaudeReportClient(): ClaudeReportClient
  unit/
    sanity.test.ts
    env.test.ts
    supabase/
      migrations.test.ts
      client.test.ts
      rate-limit-store.test.ts
    lib/
      glossary.test.ts
      rate-limit.test.ts
      integrations/
        youtube.test.ts
        scraper.test.ts
        claude.test.ts
      diagnostic/
        hook-strength.test.ts
        retention-risk.test.ts
        timing.test.ts
        format-fit.test.ts
        score.test.ts
        report.test.ts
        handler.test.ts
    components/
      GlossaryChip.test.tsx
    app/
      page.test.tsx
      diagnostic/
        page.test.tsx
        id-page.test.tsx
  e2e/
    diagnostic-smoke.spec.ts
```

---

### Task 1: Next.js + TypeScript + Tailwind project scaffold

*(Pure scaffold task — no test runner exists yet, so this deviates from the RED/GREEN cycle per the writing-plans "Task Right-Sizing" allowance. Verification is `npm run build` succeeding. Task 2 introduces the test runner and returns to strict TDD.)*

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.mjs`
- Create: `next-env.d.ts`
- Create: `tailwind.config.ts`
- Create: `postcss.config.mjs`
- Create: `.eslintrc.json`
- Create: `.gitignore`
- Create: `app/layout.tsx`
- Create: `app/globals.css`
- Create: `app/page.tsx` (placeholder — replaced in Task 24)
- Create: `docs/superpowers/README.md`
- Create: `docs/superpowers/plans/.gitkeep`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: a buildable Next.js app; `@/*` path alias declared in `tsconfig.json` (relied on by every later import)

- [ ] **Step 1: Create `package.json`**
```json
{
  "name": "creator-dashboard",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "next": "^14.2.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "@types/node": "^20.14.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "tailwindcss": "^3.4.0",
    "postcss": "^8.4.0",
    "autoprefixer": "^10.4.0",
    "eslint": "^8.57.0",
    "eslint-config-next": "^14.2.0"
  }
}
```

- [ ] **Step 2: Run `npm install`**

- [ ] **Step 3: Create TypeScript, Next.js, Tailwind, and lint config files**
```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```
```js
// next.config.mjs
/** @type {import('next').NextConfig} */
const nextConfig = {};

export default nextConfig;
```
```ts
// next-env.d.ts
/// <reference types="next" />
/// <reference types="next/image-types/global" />
```
```ts
// tailwind.config.ts
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
```
```js
// postcss.config.mjs
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```
```json
// .eslintrc.json
{
  "extends": "next/core-web-vitals"
}
```
```
# .gitignore
node_modules/
.next/
out/
.env
.env.local
.env.*.local
coverage/
playwright-report/
test-results/
*.tsbuildinfo
.DS_Store
```

- [ ] **Step 4: Create the root app shell and docs convention**
```css
/* app/globals.css */
@tailwind base;
@tailwind components;
@tailwind utilities;
```
```tsx
// app/layout.tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Creator Dashboard',
  description: 'Plain-English analytics and content coaching for new creators.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-white text-gray-900 antialiased">{children}</body>
    </html>
  );
}
```
```tsx
// app/page.tsx (placeholder — Task 24 replaces this with the real landing page)
export default function HomePage() {
  return <main className="p-8">Creator Dashboard</main>;
}
```
```markdown
# docs/superpowers/README.md
This directory holds artifacts produced by the vendored `.claude/skills/`
(superpowers) methodology:

- `plans/` — implementation plans written by the `writing-plans` skill,
  named `YYYY-MM-DD-<feature-name>.md`.

Nothing in this directory is application code; it is safe to read for
project history but is not imported by the app.
```
(create `docs/superpowers/plans/.gitkeep` as an empty file)

- [ ] **Step 5: Verify the scaffold builds**

Run: `npm run build`
Expected: build completes with exit code 0 and a `.next` directory is produced.

- [ ] **Step 6: Commit**
```bash
git add package.json package-lock.json tsconfig.json next.config.mjs next-env.d.ts tailwind.config.ts postcss.config.mjs .eslintrc.json .gitignore app/ docs/
git commit -m "chore: scaffold Next.js + TypeScript + Tailwind project"
```

---

### Task 2: Testing tooling (Vitest + Playwright + Testing Library)

**Files:**
- Create: `vitest.config.ts`
- Create: `tests/setup.ts`
- Create: `lib/constants.ts`
- Create: `playwright.config.ts`
- Test: `tests/unit/sanity.test.ts`
- Modify: `package.json` (add devDependencies + `test`, `test:watch`, `test:e2e` scripts)

**Interfaces:**
- Consumes: `@/*` path alias from `tsconfig.json` (Task 1)
- Produces: `APP_NAME` constant from `lib/constants.ts`; `npm test` and `npm run test:e2e` commands relied on by every later task

- [ ] **Step 1: Write the failing test**
```ts
// tests/unit/sanity.test.ts
import { describe, it, expect } from 'vitest';

describe('project scaffold', () => {
  it('resolves the @ path alias to the project root', async () => {
    const mod = await import('@/lib/constants');
    expect(mod.APP_NAME).toBe('Creator Dashboard');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/sanity.test.ts`
Expected: FAIL — `vitest` is not installed / no test runner configured yet.

- [ ] **Step 3: Install testing dependencies and wire up config**

Add to `package.json` `devDependencies`:
```json
"vitest": "^1.6.0",
"@vitejs/plugin-react": "^4.3.0",
"jsdom": "^24.1.0",
"@testing-library/react": "^16.0.0",
"@testing-library/jest-dom": "^6.4.0",
"@playwright/test": "^1.45.0"
```
Add to `package.json` `scripts`:
```json
"test": "vitest run",
"test:watch": "vitest",
"test:e2e": "playwright test"
```
Run: `npm install`
```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    globals: false,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
});
```
```ts
// tests/setup.ts
import '@testing-library/jest-dom/vitest';
```
```ts
// lib/constants.ts
export const APP_NAME = 'Creator Dashboard';
```
```ts
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/sanity.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add package.json package-lock.json vitest.config.ts tests/setup.ts tests/unit/sanity.test.ts lib/constants.ts playwright.config.ts
git commit -m "chore: add Vitest, Testing Library, and Playwright tooling"
```

---

### Task 3: SQL migration — `profiles`

**Files:**
- Create: `supabase/migrations/20260812000001_create_profiles.sql`
- Test: `tests/unit/supabase/migrations.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `public.profiles` table (id references `auth.users`, email, display_name, niche, created_at); relied on by every later table's foreign key and by `lib/supabase/types.ts` (Task 9)

- [ ] **Step 1: Write the failing test**
```ts
// tests/unit/supabase/migrations.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

function readMigrationContaining(needle: string): string {
  const files = readdirSync(MIGRATIONS_DIR);
  const file = files.find((f) => f.includes(needle));
  if (!file) throw new Error(`No migration file matching "${needle}"`);
  return readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
}

describe('supabase migrations', () => {
  it('includes a profiles table migration with RLS enabled', () => {
    const sql = readMigrationContaining('create_profiles');
    expect(sql).toContain('create table if not exists public.profiles');
    expect(sql).toContain('references auth.users(id)');
    expect(sql).toContain('alter table public.profiles enable row level security');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/supabase/migrations.test.ts`
Expected: FAIL with "No migration file matching \"create_profiles\"" (`supabase/migrations` doesn't exist yet)

- [ ] **Step 3: Write the migration**
```sql
-- supabase/migrations/20260812000001_create_profiles.sql
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  niche text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Profiles are viewable by owner"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Profiles are updatable by owner"
  on public.profiles for update
  using (auth.uid() = id);

-- Auto-create a profile row when a new auth user completes magic-link signup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/supabase/migrations.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/20260812000001_create_profiles.sql tests/unit/supabase/migrations.test.ts
git commit -m "feat: add profiles table migration"
```

---

### Task 4: SQL migration — `diagnostics`

**Files:**
- Create: `supabase/migrations/20260812000002_create_diagnostics.sql`
- Modify: `tests/unit/supabase/migrations.test.ts` (append a new test case)

**Interfaces:**
- Consumes: `public.profiles` (Task 3)
- Produces: `public.diagnostics` table (platform enum, status enum, per-dimension scores, `report_json`); rows written by `app/api/diagnostic/route.ts` (Task 23) and read by `app/api/diagnostic/[id]/route.ts` (Task 26)

- [ ] **Step 1: Write the failing test**

Append to the `describe('supabase migrations', ...)` block in `tests/unit/supabase/migrations.test.ts`:
```ts
  it('includes a diagnostics table migration with the expected enums and columns', () => {
    const sql = readMigrationContaining('create_diagnostics');
    expect(sql).toContain("create type public.diagnostic_platform as enum ('youtube', 'tiktok', 'instagram')");
    expect(sql).toContain("create type public.diagnostic_status as enum ('pending', 'complete', 'failed')");
    expect(sql).toContain('create table if not exists public.diagnostics');
    expect(sql).toContain('report_json jsonb');
    expect(sql).toContain('references public.profiles(id)');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/supabase/migrations.test.ts`
Expected: FAIL with "No migration file matching \"create_diagnostics\""

- [ ] **Step 3: Write the migration**
```sql
-- supabase/migrations/20260812000002_create_diagnostics.sql
create type public.diagnostic_platform as enum ('youtube', 'tiktok', 'instagram');
create type public.diagnostic_status as enum ('pending', 'complete', 'failed');

create table if not exists public.diagnostics (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  platform public.diagnostic_platform not null,
  input_url text not null,
  status public.diagnostic_status not null default 'pending',
  hook_strength_score integer,
  retention_risk_score integer,
  timing_score integer,
  format_fit_score integer,
  overall_score integer,
  report_json jsonb,
  error_message text,
  created_at timestamptz not null default now()
);

alter table public.diagnostics enable row level security;

create policy "Diagnostics are viewable by owner"
  on public.diagnostics for select
  using (auth.uid() = profile_id);

create policy "Diagnostics are insertable by owner"
  on public.diagnostics for insert
  with check (auth.uid() = profile_id);

create index if not exists diagnostics_profile_id_created_at_idx
  on public.diagnostics (profile_id, created_at desc);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/supabase/migrations.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/20260812000002_create_diagnostics.sql tests/unit/supabase/migrations.test.ts
git commit -m "feat: add diagnostics table migration"
```

---

### Task 5: SQL migration — `rate_limit_events`

**Files:**
- Create: `supabase/migrations/20260812000003_create_rate_limit_events.sql`
- Modify: `tests/unit/supabase/migrations.test.ts` (append a new test case)

**Interfaces:**
- Consumes: `public.profiles` (Task 3)
- Produces: `public.rate_limit_events` table; written/read exclusively by `lib/supabase/rate-limit-store.ts` (Task 13) via the service-role key

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/supabase/migrations.test.ts`:
```ts
  it('includes a rate_limit_events table migration indexed for lookups by profile and IP hash', () => {
    const sql = readMigrationContaining('create_rate_limit_events');
    expect(sql).toContain('create table if not exists public.rate_limit_events');
    expect(sql).toContain('ip_hash text not null');
    expect(sql).toContain('rate_limit_events_profile_id_created_at_idx');
    expect(sql).toContain('rate_limit_events_ip_hash_created_at_idx');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/supabase/migrations.test.ts`
Expected: FAIL with "No migration file matching \"create_rate_limit_events\""

- [ ] **Step 3: Write the migration**
```sql
-- supabase/migrations/20260812000003_create_rate_limit_events.sql
create table if not exists public.rate_limit_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete cascade,
  ip_hash text not null,
  event_type text not null,
  created_at timestamptz not null default now()
);

alter table public.rate_limit_events enable row level security;

-- Written and read exclusively by server-side code using the Supabase
-- service role key; no client-facing policies are granted (default deny).

create index if not exists rate_limit_events_profile_id_created_at_idx
  on public.rate_limit_events (profile_id, created_at desc);

create index if not exists rate_limit_events_ip_hash_created_at_idx
  on public.rate_limit_events (ip_hash, created_at desc);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/supabase/migrations.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/20260812000003_create_rate_limit_events.sql tests/unit/supabase/migrations.test.ts
git commit -m "feat: add rate_limit_events table migration"
```

---

### Task 6: SQL migration — `glossary_terms` (+ seed data)

**Files:**
- Create: `supabase/migrations/20260812000004_create_glossary_terms.sql`
- Modify: `tests/unit/supabase/migrations.test.ts` (append a new test case)

**Interfaces:**
- Consumes: nothing
- Produces: `public.glossary_terms` table, seeded with 6 terms whose `slug`s (`hook-rate`, `retention`, `watch-time`, `engagement-rate`, `format-fit`, `posting-window`) must exactly match the hardcoded list in `lib/glossary.ts` (Task 10)

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/supabase/migrations.test.ts`:
```ts
  it('includes a glossary_terms table migration seeded with 6 terms, readable by everyone', () => {
    const sql = readMigrationContaining('create_glossary_terms');
    expect(sql).toContain('create table if not exists public.glossary_terms');
    expect(sql).toContain('slug text not null unique');
    expect(sql).toContain('"Glossary terms are viewable by everyone"');
    const insertMatches = sql.match(/\('[a-z-]+', '[^']+', '[^']+', '[^']+'\)/g) ?? [];
    expect(insertMatches.length).toBe(6);
    expect(sql).toContain("'hook-rate'");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/supabase/migrations.test.ts`
Expected: FAIL with "No migration file matching \"create_glossary_terms\""

- [ ] **Step 3: Write the migration**
```sql
-- supabase/migrations/20260812000004_create_glossary_terms.sql
create table if not exists public.glossary_terms (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  term text not null,
  definition text not null,
  example text not null,
  created_at timestamptz not null default now()
);

alter table public.glossary_terms enable row level security;

create policy "Glossary terms are viewable by everyone"
  on public.glossary_terms for select
  using (true);

insert into public.glossary_terms (slug, term, definition, example) values
  ('hook-rate', 'Hook Rate', 'The percentage of people who keep watching past the first few seconds of your video. A high hook rate means your opening grabbed attention.', 'If 1,000 people started your video and 700 were still watching after 3 seconds, your hook rate is 70%.'),
  ('retention', 'Retention', 'How much of your video people actually watch, measured as a percentage of the total length. High retention tells the platform your content is worth showing to more people.', 'A 60-second video with 50% average retention means viewers watched about 30 seconds on average.'),
  ('watch-time', 'Watch Time', 'The total number of minutes people spend watching your content. Platforms use this to decide how far to distribute your video.', 'A video watched by 100 people for 2 minutes each has 200 minutes of watch time.'),
  ('engagement-rate', 'Engagement Rate', 'The share of viewers who like, comment, or share your post, compared to how many people saw it. It signals how much your content resonates.', 'A post with 10,000 views and 500 likes plus comments has a 5% engagement rate.'),
  ('format-fit', 'Format Fit', 'How well your video''s length and style match what tends to work best on the platform you posted to.', 'A 3-minute in-depth tutorial fits YouTube well, but might be too long for TikTok.'),
  ('posting-window', 'Posting Window', 'The window of time when your audience is most likely to be active and see a new post right after you publish it.', 'If most of your followers are online at 7pm, publishing at 7pm gives your post the best early boost.')
on conflict (slug) do nothing;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/supabase/migrations.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/20260812000004_create_glossary_terms.sql tests/unit/supabase/migrations.test.ts
git commit -m "feat: add glossary_terms table migration with seed data"
```

---

### Task 7: SQL migration — `weekly_digests`

**Files:**
- Create: `supabase/migrations/20260812000005_create_weekly_digests.sql`
- Modify: `tests/unit/supabase/migrations.test.ts` (append a new test case)

**Interfaces:**
- Consumes: `public.profiles` (Task 3)
- Produces: `public.weekly_digests` table — schema only, no application logic in this plan; reserved for the future Weekly Content Ideas plan

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/supabase/migrations.test.ts`:
```ts
  it('includes a weekly_digests table migration unique per profile per week', () => {
    const sql = readMigrationContaining('create_weekly_digests');
    expect(sql).toContain('create table if not exists public.weekly_digests');
    expect(sql).toContain('week_start date not null');
    expect(sql).toContain('unique (profile_id, week_start)');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/supabase/migrations.test.ts`
Expected: FAIL with "No migration file matching \"create_weekly_digests\""

- [ ] **Step 3: Write the migration**
```sql
-- supabase/migrations/20260812000005_create_weekly_digests.sql
create table if not exists public.weekly_digests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  week_start date not null,
  content_ideas jsonb,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (profile_id, week_start)
);

alter table public.weekly_digests enable row level security;

create policy "Weekly digests are viewable by owner"
  on public.weekly_digests for select
  using (auth.uid() = profile_id);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/supabase/migrations.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/20260812000005_create_weekly_digests.sql tests/unit/supabase/migrations.test.ts
git commit -m "feat: add weekly_digests table migration (schema only, feature built later)"
```

---

### Task 8: SQL migration — `niche_community_sources`

**Files:**
- Create: `supabase/migrations/20260812000006_create_niche_community_sources.sql`
- Modify: `tests/unit/supabase/migrations.test.ts` (append a new test case)

**Interfaces:**
- Consumes: nothing
- Produces: `public.niche_community_sources` table — schema only, reserved for the future niche-community-pulse scrape+digest logic

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/supabase/migrations.test.ts`:
```ts
  it('includes a niche_community_sources table migration unique per niche/source', () => {
    const sql = readMigrationContaining('create_niche_community_sources');
    expect(sql).toContain('create table if not exists public.niche_community_sources');
    expect(sql).toContain('source_type text not null');
    expect(sql).toContain('unique (niche, source_type, source_identifier)');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/supabase/migrations.test.ts`
Expected: FAIL with "No migration file matching \"create_niche_community_sources\""

- [ ] **Step 3: Write the migration**
```sql
-- supabase/migrations/20260812000006_create_niche_community_sources.sql
create table if not exists public.niche_community_sources (
  id uuid primary key default gen_random_uuid(),
  niche text not null,
  source_type text not null,
  source_identifier text not null,
  last_scraped_at timestamptz,
  created_at timestamptz not null default now(),
  unique (niche, source_type, source_identifier)
);

alter table public.niche_community_sources enable row level security;

-- Read by server-side digest generation only (service role); no
-- client-facing policies are granted for this table.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/supabase/migrations.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/20260812000006_create_niche_community_sources.sql tests/unit/supabase/migrations.test.ts
git commit -m "feat: add niche_community_sources table migration (schema only, feature built later)"
```

---

### Task 9: Supabase client helpers (server + browser)

**Files:**
- Create: `lib/supabase/types.ts`
- Create: `lib/supabase/browser.ts`
- Create: `lib/supabase/server.ts`
- Test: `tests/unit/supabase/client.test.ts`
- Modify: `package.json` (add `@supabase/supabase-js`, `@supabase/ssr`)

**Interfaces:**
- Consumes: table shapes from migrations (Tasks 3–8)
- Produces: `Database` type; `createSupabaseBrowserClient()`; `createSupabaseServerClient()`; `createSupabaseServiceRoleClient()` — all relied on by Tasks 13, 23, 26

- [ ] **Step 1: Write the failing test**
```ts
// tests/unit/supabase/client.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: () => ({
    get: (name: string) => (name === 'sb-test' ? { value: 'abc' } : undefined),
    set: vi.fn(),
  }),
}));

describe('Supabase client helpers', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-placeholder-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-placeholder-key';
  });

  it('builds a browser client without a live connection', async () => {
    const { createSupabaseBrowserClient } = await import('@/lib/supabase/browser');
    const client = createSupabaseBrowserClient();
    expect(typeof client.from).toBe('function');
  });

  it('builds a server client without a live connection', async () => {
    const { createSupabaseServerClient } = await import('@/lib/supabase/server');
    const client = createSupabaseServerClient();
    expect(typeof client.from).toBe('function');
  });

  it('builds a service-role client without a live connection', async () => {
    const { createSupabaseServiceRoleClient } = await import('@/lib/supabase/server');
    const client = createSupabaseServiceRoleClient();
    expect(typeof client.from).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/supabase/client.test.ts`
Expected: FAIL with "Cannot find module '@/lib/supabase/browser'"

- [ ] **Step 3: Write minimal implementation**

Add to `package.json` `dependencies`: `"@supabase/supabase-js": "^2.45.0"`, `"@supabase/ssr": "^0.5.0"`. Run `npm install`.
```ts
// lib/supabase/types.ts
export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: { id: string; email: string; display_name: string | null; niche: string | null; created_at: string };
        Insert: { id: string; email: string; display_name?: string | null; niche?: string | null; created_at?: string };
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>;
      };
      diagnostics: {
        Row: {
          id: string;
          profile_id: string;
          platform: 'youtube' | 'tiktok' | 'instagram';
          input_url: string;
          status: 'pending' | 'complete' | 'failed';
          hook_strength_score: number | null;
          retention_risk_score: number | null;
          timing_score: number | null;
          format_fit_score: number | null;
          overall_score: number | null;
          report_json: unknown | null;
          error_message: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          profile_id: string;
          platform: 'youtube' | 'tiktok' | 'instagram';
          input_url: string;
          status?: 'pending' | 'complete' | 'failed';
          hook_strength_score?: number | null;
          retention_risk_score?: number | null;
          timing_score?: number | null;
          format_fit_score?: number | null;
          overall_score?: number | null;
          report_json?: unknown | null;
          error_message?: string | null;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['diagnostics']['Insert']>;
      };
      rate_limit_events: {
        Row: { id: string; profile_id: string | null; ip_hash: string; event_type: string; created_at: string };
        Insert: { id?: string; profile_id?: string | null; ip_hash: string; event_type: string; created_at?: string };
        Update: Partial<Database['public']['Tables']['rate_limit_events']['Insert']>;
      };
      glossary_terms: {
        Row: { id: string; slug: string; term: string; definition: string; example: string; created_at: string };
        Insert: { id?: string; slug: string; term: string; definition: string; example: string; created_at?: string };
        Update: Partial<Database['public']['Tables']['glossary_terms']['Insert']>;
      };
      weekly_digests: {
        Row: { id: string; profile_id: string; week_start: string; content_ideas: unknown | null; sent_at: string | null; created_at: string };
        Insert: { id?: string; profile_id: string; week_start: string; content_ideas?: unknown | null; sent_at?: string | null; created_at?: string };
        Update: Partial<Database['public']['Tables']['weekly_digests']['Insert']>;
      };
      niche_community_sources: {
        Row: { id: string; niche: string; source_type: string; source_identifier: string; last_scraped_at: string | null; created_at: string };
        Insert: { id?: string; niche: string; source_type: string; source_identifier: string; last_scraped_at?: string | null; created_at?: string };
        Update: Partial<Database['public']['Tables']['niche_community_sources']['Insert']>;
      };
    };
  };
}
```
```ts
// lib/supabase/browser.ts
import { createBrowserClient } from '@supabase/ssr';
import type { Database } from './types';

export function createSupabaseBrowserClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```
```ts
// lib/supabase/server.ts
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from './types';

export function createSupabaseServerClient() {
  const cookieStore = cookies();
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          cookieStore.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          cookieStore.set({ name, value: '', ...options });
        },
      },
    }
  );
}

export function createSupabaseServiceRoleClient() {
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { get: () => undefined, set: () => {}, remove: () => {} } }
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/supabase/client.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add package.json package-lock.json lib/supabase/ tests/unit/supabase/client.test.ts
git commit -m "feat: add Supabase server/browser client helpers"
```

---

### Task 10: Glossary lookup module

**Files:**
- Create: `lib/glossary.ts`
- Test: `tests/unit/lib/glossary.test.ts`

**Interfaces:**
- Consumes: nothing (deliberately no dependency on the DB — the seed data in Task 6 and this list must stay in sync by convention)
- Produces: `GlossaryTerm`, `GlossarySegment`, `getGlossaryTerms()`, `findGlossaryTermBySlug(slug)`, `linkGlossaryTerms(text, terms?)` — relied on by `components/GlossaryChip.tsx` (Task 11) and `lib/diagnostic/report.ts` (Task 22)

- [ ] **Step 1: Write the failing test**
```ts
// tests/unit/lib/glossary.test.ts
import { describe, it, expect } from 'vitest';
import { getGlossaryTerms, findGlossaryTermBySlug, linkGlossaryTerms } from '@/lib/glossary';

describe('getGlossaryTerms', () => {
  it('returns the seeded set of glossary terms', () => {
    const terms = getGlossaryTerms();
    expect(terms.length).toBeGreaterThanOrEqual(6);
    expect(terms.map((t) => t.slug)).toContain('hook-rate');
  });
});

describe('findGlossaryTermBySlug', () => {
  it('finds a term by its slug', () => {
    expect(findGlossaryTermBySlug('retention')?.term).toBe('Retention');
  });

  it('returns undefined for an unknown slug', () => {
    expect(findGlossaryTermBySlug('not-a-real-term')).toBeUndefined();
  });
});

describe('linkGlossaryTerms', () => {
  it('splits text into text and term segments', () => {
    const segments = linkGlossaryTerms('Your hook rate was low this week.');
    const termSegment = segments.find((s) => s.type === 'term');
    expect(termSegment).toBeDefined();
    expect(termSegment?.value.toLowerCase()).toBe('hook rate');
    if (termSegment?.type === 'term') {
      expect(termSegment.term.slug).toBe('hook-rate');
    }
  });

  it('returns a single text segment when no terms match', () => {
    const segments = linkGlossaryTerms('Nothing jargon-y here.');
    expect(segments).toEqual([{ type: 'text', value: 'Nothing jargon-y here.' }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/glossary.test.ts`
Expected: FAIL with "Cannot find module '@/lib/glossary'"

- [ ] **Step 3: Write minimal implementation**
```ts
// lib/glossary.ts
export interface GlossaryTerm {
  slug: string;
  term: string;
  definition: string;
  example: string;
}

export const GLOSSARY_TERMS: GlossaryTerm[] = [
  { slug: 'hook-rate', term: 'Hook Rate', definition: 'The percentage of people who keep watching past the first few seconds of your video. A high hook rate means your opening grabbed attention.', example: 'If 1,000 people started your video and 700 were still watching after 3 seconds, your hook rate is 70%.' },
  { slug: 'retention', term: 'Retention', definition: 'How much of your video people actually watch, measured as a percentage of the total length. High retention tells the platform your content is worth showing to more people.', example: 'A 60-second video with 50% average retention means viewers watched about 30 seconds on average.' },
  { slug: 'watch-time', term: 'Watch Time', definition: 'The total number of minutes people spend watching your content. Platforms use this to decide how far to distribute your video.', example: 'A video watched by 100 people for 2 minutes each has 200 minutes of watch time.' },
  { slug: 'engagement-rate', term: 'Engagement Rate', definition: 'The share of viewers who like, comment, or share your post, compared to how many people saw it. It signals how much your content resonates.', example: 'A post with 10,000 views and 500 likes plus comments has a 5% engagement rate.' },
  { slug: 'format-fit', term: 'Format Fit', definition: "How well your video's length and style match what tends to work best on the platform you posted to.", example: 'A 3-minute in-depth tutorial fits YouTube well, but might be too long for TikTok.' },
  { slug: 'posting-window', term: 'Posting Window', definition: 'The window of time when your audience is most likely to be active and see a new post right after you publish it.', example: 'If most of your followers are online at 7pm, publishing at 7pm gives your post the best early boost.' },
];

export function getGlossaryTerms(): GlossaryTerm[] {
  return GLOSSARY_TERMS;
}

export function findGlossaryTermBySlug(slug: string): GlossaryTerm | undefined {
  return GLOSSARY_TERMS.find((t) => t.slug === slug);
}

export type GlossarySegment =
  | { type: 'text'; value: string }
  | { type: 'term'; value: string; term: GlossaryTerm };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function linkGlossaryTerms(text: string, terms: GlossaryTerm[] = GLOSSARY_TERMS): GlossarySegment[] {
  if (!text) return [];
  const sorted = [...terms].sort((a, b) => b.term.length - a.term.length);
  const pattern = sorted.map((t) => escapeRegExp(t.term)).join('|');
  if (!pattern) return [{ type: 'text', value: text }];

  const regex = new RegExp(`\\b(${pattern})\\b`, 'gi');
  const segments: GlossarySegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    const matchedTerm = terms.find((t) => t.term.toLowerCase() === match![0].toLowerCase())!;
    segments.push({ type: 'term', value: match[0], term: matchedTerm });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) });
  }
  return segments;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/glossary.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add lib/glossary.ts tests/unit/lib/glossary.test.ts
git commit -m "feat: add glossary lookup and term-linking module"
```

---

### Task 11: `GlossaryChip` / `GlossaryText` UI component

**Files:**
- Create: `components/GlossaryChip.tsx`
- Test: `tests/unit/components/GlossaryChip.test.tsx`

**Interfaces:**
- Consumes: `GlossaryTerm`, `linkGlossaryTerms`, `findGlossaryTermBySlug` from `@/lib/glossary` (Task 10)
- Produces: `<GlossaryChip term={GlossaryTerm}>`, `<GlossaryText text={string}>` — relied on by `app/diagnostic/[id]/page.tsx` (Task 26)

- [ ] **Step 1: Write the failing test**
```tsx
// tests/unit/components/GlossaryChip.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GlossaryChip, GlossaryText } from '@/components/GlossaryChip';
import { findGlossaryTermBySlug } from '@/lib/glossary';

describe('GlossaryChip', () => {
  it('shows the definition tooltip when clicked', () => {
    const term = findGlossaryTermBySlug('hook-rate')!;
    render(<GlossaryChip term={term}>hook rate</GlossaryChip>);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'hook rate' }));
    expect(screen.getByRole('tooltip')).toHaveTextContent(term.definition);
  });
});

describe('GlossaryText', () => {
  it('renders recognized terms as clickable glossary chips', () => {
    render(<GlossaryText text="Your hook rate was low this week." />);
    expect(screen.getByRole('button', { name: 'hook rate' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/GlossaryChip.test.tsx`
Expected: FAIL with "Cannot find module '@/components/GlossaryChip'"

- [ ] **Step 3: Write minimal implementation**
```tsx
// components/GlossaryChip.tsx
'use client';

import { useState } from 'react';
import { linkGlossaryTerms, type GlossaryTerm } from '@/lib/glossary';

export interface GlossaryChipProps {
  term: GlossaryTerm;
  children: React.ReactNode;
}

export function GlossaryChip({ term, children }: GlossaryChipProps) {
  const [open, setOpen] = useState(false);

  return (
    <span className="relative inline-block">
      <button
        type="button"
        className="underline decoration-dotted decoration-2 underline-offset-2 text-indigo-700 hover:text-indigo-900"
        aria-expanded={open}
        aria-describedby={`glossary-${term.slug}`}
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        {children}
      </button>
      {open && (
        <span
          id={`glossary-${term.slug}`}
          role="tooltip"
          className="absolute z-10 mt-2 w-64 rounded-lg border border-gray-200 bg-white p-3 text-sm shadow-lg"
        >
          <span className="block font-semibold text-gray-900">{term.term}</span>
          <span className="mt-1 block text-gray-700">{term.definition}</span>
          <span className="mt-1 block italic text-gray-500">{term.example}</span>
        </span>
      )}
    </span>
  );
}

export interface GlossaryTextProps {
  text: string;
}

export function GlossaryText({ text }: GlossaryTextProps) {
  const segments = linkGlossaryTerms(text);
  return (
    <>
      {segments.map((segment, i) =>
        segment.type === 'term' ? (
          <GlossaryChip key={i} term={segment.term}>
            {segment.value}
          </GlossaryChip>
        ) : (
          <span key={i}>{segment.value}</span>
        )
      )}
    </>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/GlossaryChip.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add components/GlossaryChip.tsx tests/unit/components/GlossaryChip.test.tsx
git commit -m "feat: add GlossaryChip and GlossaryText UI components"
```

---

### Task 12: Rate limit core logic (pure, store-agnostic)

**Files:**
- Create: `lib/rate-limit.ts`
- Create: `tests/fakes/rate-limit-store.fake.ts`
- Test: `tests/unit/lib/rate-limit.test.ts`

**Interfaces:**
- Consumes: nothing (no Supabase dependency — testable in isolation)
- Produces: `RateLimitStore`, `checkRateLimit`, `recordRateLimitEvent`, `hashIp`, `FREE_DIAGNOSTIC_WINDOW_DAYS`, `FREE_DIAGNOSTIC_LIMIT_PER_PROFILE`, `MAX_PROFILES_PER_IP_WINDOW` — relied on by `lib/supabase/rate-limit-store.ts` (Task 13) and `lib/diagnostic/handler.ts` (Task 23); `createInMemoryRateLimitStore` relied on by Tasks 13 and 23's tests

- [ ] **Step 1: Write the failing test**
```ts
// tests/unit/lib/rate-limit.test.ts
import { describe, it, expect } from 'vitest';
import { checkRateLimit, recordRateLimitEvent, hashIp } from '@/lib/rate-limit';
import { createInMemoryRateLimitStore } from '../../fakes/rate-limit-store.fake';

describe('checkRateLimit', () => {
  it('allows the first diagnostic request for a fresh profile', async () => {
    const store = createInMemoryRateLimitStore();
    const result = await checkRateLimit({
      store,
      profileId: 'profile-1',
      ipHash: 'ip-hash-1',
      eventType: 'diagnostic_request',
    });
    expect(result.allowed).toBe(true);
  });

  it('blocks a second diagnostic request within the rolling window', async () => {
    const store = createInMemoryRateLimitStore();
    await recordRateLimitEvent({ store, profileId: 'profile-1', ipHash: 'ip-hash-1', eventType: 'diagnostic_request' });
    const result = await checkRateLimit({
      store,
      profileId: 'profile-1',
      ipHash: 'ip-hash-1',
      eventType: 'diagnostic_request',
      now: new Date('2026-08-12T12:00:00Z'),
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('profile_limit');
  });

  it('allows the same profile again after the window has passed', async () => {
    const store = createInMemoryRateLimitStore();
    await recordRateLimitEvent({
      store,
      profileId: 'profile-1',
      ipHash: 'ip-hash-1',
      eventType: 'diagnostic_request',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
    const result = await checkRateLimit({
      store,
      profileId: 'profile-1',
      ipHash: 'ip-hash-1',
      eventType: 'diagnostic_request',
      now: new Date('2026-08-12T12:00:00Z'),
    });
    expect(result.allowed).toBe(true);
  });

  it('blocks a fourth distinct profile from the same IP within the window', async () => {
    const store = createInMemoryRateLimitStore();
    await recordRateLimitEvent({ store, profileId: 'profile-1', ipHash: 'shared-ip', eventType: 'diagnostic_request' });
    await recordRateLimitEvent({ store, profileId: 'profile-2', ipHash: 'shared-ip', eventType: 'diagnostic_request' });
    await recordRateLimitEvent({ store, profileId: 'profile-3', ipHash: 'shared-ip', eventType: 'diagnostic_request' });
    const result = await checkRateLimit({
      store,
      profileId: 'profile-4',
      ipHash: 'shared-ip',
      eventType: 'diagnostic_request',
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('ip_limit');
  });
});

describe('hashIp', () => {
  it('produces a deterministic hash for the same IP and salt', () => {
    expect(hashIp('203.0.113.7', 'test-salt')).toBe(hashIp('203.0.113.7', 'test-salt'));
  });

  it('produces different hashes for different IPs', () => {
    expect(hashIp('203.0.113.7', 'test-salt')).not.toBe(hashIp('203.0.113.8', 'test-salt'));
  });
});
```
```ts
// tests/fakes/rate-limit-store.fake.ts
import type { RateLimitStore } from '@/lib/rate-limit';

interface StoredEvent {
  profileId: string | null;
  ipHash: string;
  eventType: string;
  createdAt: Date;
}

export function createInMemoryRateLimitStore(): RateLimitStore {
  const events: StoredEvent[] = [];

  return {
    async countEventsSince({ profileId, ipHash, eventType, since }) {
      return events.filter((e) => {
        if (e.eventType !== eventType) return false;
        if (e.createdAt < since) return false;
        if (profileId !== undefined && e.profileId !== profileId) return false;
        if (ipHash !== undefined && e.ipHash !== ipHash) return false;
        return true;
      }).length;
    },
    async recordEvent({ profileId, ipHash, eventType, createdAt }) {
      events.push({ profileId, ipHash, eventType, createdAt: createdAt ?? new Date() });
    },
  };
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/rate-limit.test.ts`
Expected: FAIL with "Cannot find module '@/lib/rate-limit'"

- [ ] **Step 3: Write minimal implementation**
```ts
// lib/rate-limit.ts
import { createHash } from 'node:crypto';

export const FREE_DIAGNOSTIC_WINDOW_DAYS = 30;
export const FREE_DIAGNOSTIC_LIMIT_PER_PROFILE = 1;
export const MAX_PROFILES_PER_IP_WINDOW = 3;

export interface RateLimitStore {
  countEventsSince(params: { profileId?: string; ipHash?: string; eventType: string; since: Date }): Promise<number>;
  recordEvent(params: { profileId: string | null; ipHash: string; eventType: string; createdAt?: Date }): Promise<void>;
}

export interface RateLimitCheckParams {
  store: RateLimitStore;
  profileId: string;
  ipHash: string;
  eventType: string;
  now?: Date;
}

export interface RateLimitCheckResult {
  allowed: boolean;
  reason?: 'profile_limit' | 'ip_limit';
  retryAfter?: Date;
}

export async function checkRateLimit(params: RateLimitCheckParams): Promise<RateLimitCheckResult> {
  const now = params.now ?? new Date();
  const windowMs = FREE_DIAGNOSTIC_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const windowStart = new Date(now.getTime() - windowMs);

  const profileCount = await params.store.countEventsSince({
    profileId: params.profileId,
    eventType: params.eventType,
    since: windowStart,
  });
  if (profileCount >= FREE_DIAGNOSTIC_LIMIT_PER_PROFILE) {
    return { allowed: false, reason: 'profile_limit', retryAfter: new Date(now.getTime() + windowMs) };
  }

  const ipCount = await params.store.countEventsSince({
    ipHash: params.ipHash,
    eventType: params.eventType,
    since: windowStart,
  });
  if (ipCount >= MAX_PROFILES_PER_IP_WINDOW) {
    return { allowed: false, reason: 'ip_limit', retryAfter: new Date(now.getTime() + windowMs) };
  }

  return { allowed: true };
}

export async function recordRateLimitEvent(params: {
  store: RateLimitStore;
  profileId: string | null;
  ipHash: string;
  eventType: string;
  createdAt?: Date;
}): Promise<void> {
  await params.store.recordEvent(params);
}

export function hashIp(ip: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/rate-limit.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add lib/rate-limit.ts tests/fakes/rate-limit-store.fake.ts tests/unit/lib/rate-limit.test.ts
git commit -m "feat: add rate limiting core logic with an in-memory fake store"
```

---

### Task 13: Supabase-backed rate limit store

**Files:**
- Create: `lib/supabase/rate-limit-store.ts`
- Create: `tests/fakes/supabase-query-builder.fake.ts`
- Test: `tests/unit/supabase/rate-limit-store.test.ts`

**Interfaces:**
- Consumes: `RateLimitStore` type (Task 12), `Database` type (Task 9)
- Produces: `createSupabaseRateLimitStore(supabase)` — relied on by `app/api/diagnostic/route.ts` (Task 23)

- [ ] **Step 1: Write the failing test**
```ts
// tests/fakes/supabase-query-builder.fake.ts
export interface FakeRow {
  [key: string]: unknown;
}

export function createFakeSupabaseClient(initialRows: Record<string, FakeRow[]> = {}) {
  const tables: Record<string, FakeRow[]> = { ...initialRows };

  return {
    from(table: string) {
      const rows = tables[table] ?? (tables[table] = []);
      return {
        select(_columns: string, _opts?: { count?: string; head?: boolean }) {
          const filters: Array<(row: FakeRow) => boolean> = [];
          const builder = {
            eq(column: string, value: unknown) {
              filters.push((row) => row[column] === value);
              return builder;
            },
            gte(column: string, value: unknown) {
              filters.push((row) => (row[column] as string) >= (value as string));
              return builder;
            },
            then(resolve: (result: { count: number; error: null }) => void) {
              const matched = rows.filter((row) => filters.every((f) => f(row)));
              resolve({ count: matched.length, error: null });
            },
          };
          return builder;
        },
        insert(row: FakeRow) {
          rows.push({ id: `${rows.length + 1}`, ...row });
          return Promise.resolve({ error: null });
        },
      };
    },
    __getRows(table: string) {
      return tables[table] ?? [];
    },
  };
}
```
```ts
// tests/unit/supabase/rate-limit-store.test.ts
import { describe, it, expect } from 'vitest';
import { createSupabaseRateLimitStore } from '@/lib/supabase/rate-limit-store';
import { createFakeSupabaseClient } from '../../fakes/supabase-query-builder.fake';

describe('createSupabaseRateLimitStore', () => {
  it('counts zero events for a profile with no history', async () => {
    const client = createFakeSupabaseClient();
    const store = createSupabaseRateLimitStore(client as any);
    const count = await store.countEventsSince({
      profileId: 'profile-1',
      eventType: 'diagnostic_request',
      since: new Date('2026-01-01T00:00:00Z'),
    });
    expect(count).toBe(0);
  });

  it('records an event and then counts it', async () => {
    const client = createFakeSupabaseClient();
    const store = createSupabaseRateLimitStore(client as any);
    await store.recordEvent({
      profileId: 'profile-1',
      ipHash: 'ip-hash-1',
      eventType: 'diagnostic_request',
      createdAt: new Date('2026-08-12T00:00:00Z'),
    });
    const count = await store.countEventsSince({
      profileId: 'profile-1',
      eventType: 'diagnostic_request',
      since: new Date('2026-01-01T00:00:00Z'),
    });
    expect(count).toBe(1);
  });

  it('excludes events outside the requested window', async () => {
    const client = createFakeSupabaseClient();
    const store = createSupabaseRateLimitStore(client as any);
    await store.recordEvent({
      profileId: 'profile-1',
      ipHash: 'ip-hash-1',
      eventType: 'diagnostic_request',
      createdAt: new Date('2025-01-01T00:00:00Z'),
    });
    const count = await store.countEventsSince({
      profileId: 'profile-1',
      eventType: 'diagnostic_request',
      since: new Date('2026-01-01T00:00:00Z'),
    });
    expect(count).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/supabase/rate-limit-store.test.ts`
Expected: FAIL with "Cannot find module '@/lib/supabase/rate-limit-store'"

- [ ] **Step 3: Write minimal implementation**
```ts
// lib/supabase/rate-limit-store.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';
import type { RateLimitStore } from '@/lib/rate-limit';

export function createSupabaseRateLimitStore(supabase: SupabaseClient<Database>): RateLimitStore {
  return {
    async countEventsSince({ profileId, ipHash, eventType, since }) {
      let query = supabase
        .from('rate_limit_events')
        .select('id', { count: 'exact', head: true })
        .eq('event_type', eventType)
        .gte('created_at', since.toISOString());

      if (profileId !== undefined) {
        query = query.eq('profile_id', profileId);
      }
      if (ipHash !== undefined) {
        query = query.eq('ip_hash', ipHash);
      }

      const { count, error } = await query;
      if (error) {
        throw new Error(`Failed to count rate limit events: ${error.message}`);
      }
      return count ?? 0;
    },
    async recordEvent({ profileId, ipHash, eventType, createdAt }) {
      const { error } = await supabase.from('rate_limit_events').insert({
        profile_id: profileId,
        ip_hash: ipHash,
        event_type: eventType,
        created_at: (createdAt ?? new Date()).toISOString(),
      });
      if (error) {
        throw new Error(`Failed to record rate limit event: ${error.message}`);
      }
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/supabase/rate-limit-store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add lib/supabase/rate-limit-store.ts tests/fakes/supabase-query-builder.fake.ts tests/unit/supabase/rate-limit-store.test.ts
git commit -m "feat: add Supabase-backed rate limit store adapter"
```

---

### Task 14: YouTube integration module

**Files:**
- Create: `lib/integrations/youtube.ts`
- Create: `tests/fakes/youtube.fake.ts`
- Test: `tests/unit/lib/integrations/youtube.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `VideoMetadata`, `YouTubeClient`, `extractYouTubeVideoId(url)`, `createYouTubeClient(apiKey)` — relied on by `lib/diagnostic/handler.ts` (Task 23); `createFakeYouTubeClient` relied on by Task 23's test

- [ ] **Step 1: Write the failing test**
```ts
// tests/unit/lib/integrations/youtube.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { extractYouTubeVideoId, createYouTubeClient } from '@/lib/integrations/youtube';

describe('extractYouTubeVideoId', () => {
  it('extracts the video id from a standard watch URL', () => {
    expect(extractYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts the video id from a youtu.be short URL', () => {
    expect(extractYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts the video id from a Shorts URL', () => {
    expect(extractYouTubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('returns null for a non-YouTube URL', () => {
    expect(extractYouTubeVideoId('https://example.com/video')).toBeNull();
  });
});

describe('createYouTubeClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches and normalizes video metadata from the YouTube Data API', async () => {
    const fakeResponse = {
      items: [
        {
          snippet: {
            title: 'How I grew to 10k subscribers',
            description: 'A breakdown of my strategy',
            publishedAt: '2026-07-01T14:00:00Z',
            tags: ['creator', 'growth'],
          },
          statistics: { viewCount: '15000', likeCount: '900', commentCount: '120' },
          contentDetails: { duration: 'PT4M32S' },
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => fakeResponse });
    vi.stubGlobal('fetch', fetchMock);

    const client = createYouTubeClient('test-api-key');
    const metadata = await client.getVideoMetadata('dQw4w9WgXcQ');

    expect(metadata).toEqual({
      id: 'dQw4w9WgXcQ',
      title: 'How I grew to 10k subscribers',
      description: 'A breakdown of my strategy',
      publishedAt: '2026-07-01T14:00:00Z',
      durationSeconds: 272,
      viewCount: 15000,
      likeCount: 900,
      commentCount: 120,
      tags: ['creator', 'growth'],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('videos');
  });

  it('throws when the API returns no matching video', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ items: [] }) }));
    const client = createYouTubeClient('test-api-key');
    await expect(client.getVideoMetadata('missing-id')).rejects.toThrow('No YouTube video found');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/integrations/youtube.test.ts`
Expected: FAIL with "Cannot find module '@/lib/integrations/youtube'"

- [ ] **Step 3: Write minimal implementation**
```ts
// lib/integrations/youtube.ts
export interface VideoMetadata {
  id: string;
  title: string;
  description: string;
  publishedAt: string;
  durationSeconds: number;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  tags: string[];
}

export interface YouTubeClient {
  extractVideoId(url: string): string | null;
  getVideoMetadata(videoId: string): Promise<VideoMetadata>;
}

export function extractYouTubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'youtu.be') {
      return parsed.pathname.slice(1) || null;
    }
    if (parsed.hostname.includes('youtube.com')) {
      if (parsed.pathname === '/watch') {
        return parsed.searchParams.get('v');
      }
      if (parsed.pathname.startsWith('/shorts/')) {
        return parsed.pathname.split('/')[2] ?? null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function parseIso8601Duration(iso: string): number {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!match) return 0;
  const [, hours, minutes, seconds] = match;
  return (Number(hours) || 0) * 3600 + (Number(minutes) || 0) * 60 + (Number(seconds) || 0);
}

export function createYouTubeClient(apiKey: string): YouTubeClient {
  return {
    extractVideoId: extractYouTubeVideoId,
    async getVideoMetadata(videoId: string): Promise<VideoMetadata> {
      const url = new URL('https://www.googleapis.com/youtube/v3/videos');
      url.searchParams.set('id', videoId);
      url.searchParams.set('part', 'snippet,statistics,contentDetails');
      url.searchParams.set('key', apiKey);

      const response = await fetch(url.toString());
      if (!response.ok) {
        throw new Error(`YouTube API request failed with status ${response.status}`);
      }
      const data = await response.json();
      const item = data.items?.[0];
      if (!item) {
        throw new Error(`No YouTube video found for id ${videoId}`);
      }
      return {
        id: videoId,
        title: item.snippet.title,
        description: item.snippet.description,
        publishedAt: item.snippet.publishedAt,
        durationSeconds: parseIso8601Duration(item.contentDetails.duration),
        viewCount: Number(item.statistics.viewCount ?? 0),
        likeCount: Number(item.statistics.likeCount ?? 0),
        commentCount: Number(item.statistics.commentCount ?? 0),
        tags: item.snippet.tags ?? [],
      };
    },
  };
}
```
```ts
// tests/fakes/youtube.fake.ts
import type { YouTubeClient, VideoMetadata } from '@/lib/integrations/youtube';

export function createFakeYouTubeClient(overrides: Partial<VideoMetadata> = {}): YouTubeClient {
  const metadata: VideoMetadata = {
    id: 'fake-video-id',
    title: 'How to hook viewers in 3 seconds',
    description: 'A tutorial about hooks',
    publishedAt: '2026-08-05T19:00:00Z',
    durationSeconds: 180,
    viewCount: 5000,
    likeCount: 400,
    commentCount: 50,
    tags: ['tutorial'],
    ...overrides,
  };
  return {
    extractVideoId: (url: string) => (url.includes('youtube') ? 'fake-video-id' : null),
    getVideoMetadata: async () => metadata,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/integrations/youtube.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add lib/integrations/youtube.ts tests/fakes/youtube.fake.ts tests/unit/lib/integrations/youtube.test.ts
git commit -m "feat: add YouTube Data API integration module"
```

---

### Task 15: Scraper (Apify) integration module

**Files:**
- Create: `lib/integrations/scraper.ts`
- Create: `tests/fakes/scraper.fake.ts`
- Test: `tests/unit/lib/integrations/scraper.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `SocialPostMetadata`, `ScraperClient`, `detectSocialPlatform(url)`, `createApifyScraperClient(apiToken)` — relied on by `lib/diagnostic/handler.ts` (Task 23); `createFakeScraperClient` relied on by Task 23's test

- [ ] **Step 1: Write the failing test**
```ts
// tests/unit/lib/integrations/scraper.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { detectSocialPlatform, createApifyScraperClient } from '@/lib/integrations/scraper';

describe('detectSocialPlatform', () => {
  it('detects TikTok URLs', () => {
    expect(detectSocialPlatform('https://www.tiktok.com/@user/video/12345')).toBe('tiktok');
  });

  it('detects Instagram URLs', () => {
    expect(detectSocialPlatform('https://www.instagram.com/reel/abc123/')).toBe('instagram');
  });

  it('returns null for unrelated URLs', () => {
    expect(detectSocialPlatform('https://example.com')).toBeNull();
  });
});

describe('createApifyScraperClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches and normalizes a TikTok post via the Apify dataset API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        {
          id: '12345',
          text: 'Day 1 of posting every day #creator',
          createTimeISO: '2026-08-01T10:00:00Z',
          videoDuration: 32,
          playCount: 20000,
          diggCount: 1500,
          commentCount: 80,
        },
      ],
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createApifyScraperClient('test-token');
    const post = await client.fetchPost('https://www.tiktok.com/@user/video/12345');

    expect(post).toEqual({
      platform: 'tiktok',
      id: '12345',
      caption: 'Day 1 of posting every day #creator',
      publishedAt: '2026-08-01T10:00:00Z',
      durationSeconds: 32,
      viewCount: 20000,
      likeCount: 1500,
      commentCount: 80,
    });
  });

  it('throws for an unsupported URL', async () => {
    const client = createApifyScraperClient('test-token');
    await expect(client.fetchPost('https://example.com/x')).rejects.toThrow('Unsupported social URL');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/integrations/scraper.test.ts`
Expected: FAIL with "Cannot find module '@/lib/integrations/scraper'"

- [ ] **Step 3: Write minimal implementation**
```ts
// lib/integrations/scraper.ts
export interface SocialPostMetadata {
  platform: 'tiktok' | 'instagram';
  id: string;
  caption: string;
  publishedAt: string;
  durationSeconds: number;
  viewCount: number;
  likeCount: number;
  commentCount: number;
}

export interface ScraperClient {
  detectPlatform(url: string): 'tiktok' | 'instagram' | null;
  fetchPost(url: string): Promise<SocialPostMetadata>;
}

export function detectSocialPlatform(url: string): 'tiktok' | 'instagram' | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('tiktok.com')) return 'tiktok';
    if (parsed.hostname.includes('instagram.com')) return 'instagram';
    return null;
  } catch {
    return null;
  }
}

const APIFY_ACTORS: Record<'tiktok' | 'instagram', string> = {
  tiktok: 'clockworks~tiktok-scraper',
  instagram: 'apify~instagram-scraper',
};

export function createApifyScraperClient(apiToken: string): ScraperClient {
  return {
    detectPlatform: detectSocialPlatform,
    async fetchPost(url: string): Promise<SocialPostMetadata> {
      const platform = detectSocialPlatform(url);
      if (!platform) {
        throw new Error(`Unsupported social URL: ${url}`);
      }
      const actorId = APIFY_ACTORS[platform];
      const runUrl = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${apiToken}`;
      const response = await fetch(runUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startUrls: [{ url }] }),
      });
      if (!response.ok) {
        throw new Error(`Apify scrape failed with status ${response.status}`);
      }
      const items = await response.json();
      const item = items[0];
      if (!item) {
        throw new Error(`Apify returned no data for ${url}`);
      }
      return {
        platform,
        id: String(item.id ?? item.videoId ?? item.shortCode ?? url),
        caption: item.text ?? item.caption ?? '',
        publishedAt: item.createTimeISO ?? item.timestamp ?? new Date().toISOString(),
        durationSeconds: Number(item.videoDuration ?? item.duration ?? 0),
        viewCount: Number(item.playCount ?? item.videoViewCount ?? item.viewCount ?? 0),
        likeCount: Number(item.diggCount ?? item.likesCount ?? item.likeCount ?? 0),
        commentCount: Number(item.commentCount ?? 0),
      };
    },
  };
}
```
```ts
// tests/fakes/scraper.fake.ts
import type { ScraperClient, SocialPostMetadata } from '@/lib/integrations/scraper';
import { detectSocialPlatform } from '@/lib/integrations/scraper';

export function createFakeScraperClient(overrides: Partial<SocialPostMetadata> = {}): ScraperClient {
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
  return {
    detectPlatform: detectSocialPlatform,
    fetchPost: async () => metadata,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/integrations/scraper.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add lib/integrations/scraper.ts tests/fakes/scraper.fake.ts tests/unit/lib/integrations/scraper.test.ts
git commit -m "feat: add Apify TikTok/Instagram scraper integration module"
```

---

### Task 16: Claude integration module

**Files:**
- Create: `lib/integrations/claude.ts`
- Create: `tests/fakes/claude.fake.ts`
- Test: `tests/unit/lib/integrations/claude.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `ReportGenerationInput`, `GeneratedReport`, `ClaudeReportClient`, `DIAGNOSTIC_SYSTEM_PROMPT`, `createClaudeReportClient(apiKey, model?)` — relied on by `lib/diagnostic/report.ts` (Task 22); `createFakeClaudeReportClient` relied on by Tasks 22 and 23's tests

- [ ] **Step 1: Write the failing test**
```ts
// tests/unit/lib/integrations/claude.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createClaudeReportClient, DIAGNOSTIC_SYSTEM_PROMPT } from '@/lib/integrations/claude';

describe('DIAGNOSTIC_SYSTEM_PROMPT', () => {
  it('requires every score to be explained with a why', () => {
    expect(DIAGNOSTIC_SYSTEM_PROMPT).toContain('WHY');
    expect(DIAGNOSTIC_SYSTEM_PROMPT.toLowerCase()).toContain('plain english');
  });
});

describe('createClaudeReportClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the diagnostic system prompt and parses the JSON response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ text: JSON.stringify({ headline: 'Strong hook, weak finish', explanation: 'Your hook rate is high because...' }) }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createClaudeReportClient('test-api-key');
    const report = await client.generateDiagnosticReport({
      platform: 'youtube',
      postSummary: 'A 3 minute tutorial about hooks',
      scores: {
        hookStrength: { value: 80, label: 'strong' },
        retentionRisk: { value: 40, label: 'moderate' },
        timing: { value: 60, label: 'moderate' },
        formatFit: { value: 90, label: 'strong' },
      },
    });

    expect(report.headline).toBe('Strong hook, weak finish');
    expect(report.explanation).toContain('hook rate');
    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body as string);
    expect(body.system).toBe(DIAGNOSTIC_SYSTEM_PROMPT);
  });

  it('throws when the API request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const client = createClaudeReportClient('test-api-key');
    await expect(
      client.generateDiagnosticReport({
        platform: 'youtube',
        postSummary: 'x',
        scores: {
          hookStrength: { value: 1, label: 'weak' },
          retentionRisk: { value: 1, label: 'weak' },
          timing: { value: 1, label: 'weak' },
          formatFit: { value: 1, label: 'weak' },
        },
      })
    ).rejects.toThrow('Claude API request failed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/integrations/claude.test.ts`
Expected: FAIL with "Cannot find module '@/lib/integrations/claude'"

- [ ] **Step 3: Write minimal implementation**
```ts
// lib/integrations/claude.ts
export interface ReportScoreSummary {
  value: number;
  label: string;
}

export interface ReportGenerationInput {
  platform: 'youtube' | 'tiktok' | 'instagram';
  postSummary: string;
  scores: {
    hookStrength: ReportScoreSummary;
    retentionRisk: ReportScoreSummary;
    timing: ReportScoreSummary;
    formatFit: ReportScoreSummary;
  };
}

export interface GeneratedReport {
  headline: string;
  explanation: string;
}

export interface ClaudeReportClient {
  generateDiagnosticReport(input: ReportGenerationInput): Promise<GeneratedReport>;
}

export const DIAGNOSTIC_SYSTEM_PROMPT = `You are the report-writing engine for Creator Dashboard, a tool for creators under 5,000 followers who are new to analytics.
Write in plain English for a 16-24 year old creator who does not know terms like "retention" or "hook rate".
For every score you mention, you MUST explain WHY it is what it is in cause-and-effect terms the creator can act on.
Never state a score without a "why" explanation directly next to it.
Keep the tone encouraging but honest. Avoid jargon; when a technical term is unavoidable, use its plain name (hook rate, retention, engagement rate, format fit, posting window).
Respond with a short headline (max 12 words) and a 3-5 sentence explanation.`;

export function createClaudeReportClient(apiKey: string, model = 'claude-sonnet-4-5'): ClaudeReportClient {
  return {
    async generateDiagnosticReport(input: ReportGenerationInput): Promise<GeneratedReport> {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 512,
          system: DIAGNOSTIC_SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: `Platform: ${input.platform}\nPost summary: ${input.postSummary}\nHook strength: ${input.scores.hookStrength.value} (${input.scores.hookStrength.label})\nRetention risk: ${input.scores.retentionRisk.value} (${input.scores.retentionRisk.label})\nTiming: ${input.scores.timing.value} (${input.scores.timing.label})\nFormat fit: ${input.scores.formatFit.value} (${input.scores.formatFit.label})\n\nRespond as JSON: {"headline": string, "explanation": string}`,
            },
          ],
        }),
      });
      if (!response.ok) {
        throw new Error(`Claude API request failed with status ${response.status}`);
      }
      const data = await response.json();
      const text = data.content?.[0]?.text ?? '{}';
      const parsed = JSON.parse(text);
      return {
        headline: parsed.headline ?? 'Your diagnostic report',
        explanation: parsed.explanation ?? '',
      };
    },
  };
}
```
```ts
// tests/fakes/claude.fake.ts
import type { ClaudeReportClient, GeneratedReport, ReportGenerationInput } from '@/lib/integrations/claude';

export function createFakeClaudeReportClient(overrides: Partial<GeneratedReport> = {}): ClaudeReportClient {
  return {
    async generateDiagnosticReport(input: ReportGenerationInput): Promise<GeneratedReport> {
      return {
        headline: `Your ${input.platform} post scored ${input.scores.hookStrength.label} on hook strength`,
        explanation: `Your hook rate looks ${input.scores.hookStrength.label} because of early engagement. Retention risk is ${input.scores.retentionRisk.label}. Your posting window timing was ${input.scores.timing.label}, and format fit was ${input.scores.formatFit.label}.`,
        ...overrides,
      };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/integrations/claude.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add lib/integrations/claude.ts tests/fakes/claude.fake.ts tests/unit/lib/integrations/claude.test.ts
git commit -m "feat: add Claude report generation integration module"
```

---

### Task 17: Diagnostic scoring — hook strength (+ shared score types)

**Files:**
- Create: `lib/diagnostic/types.ts`
- Create: `lib/diagnostic/hook-strength.ts`
- Test: `tests/unit/lib/diagnostic/hook-strength.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `ScoreLabel`, `ScoreResult`, `labelForScore(score)` (shared by Tasks 18–21); `HookStrengthInput`, `scoreHookStrength(input)` — relied on by `lib/diagnostic/report.ts` (Task 22)

- [ ] **Step 1: Write the failing test**
```ts
// tests/unit/lib/diagnostic/hook-strength.test.ts
import { describe, it, expect } from 'vitest';
import { scoreHookStrength } from '@/lib/diagnostic/hook-strength';

describe('scoreHookStrength', () => {
  it('scores high engagement with a curiosity-pattern caption as strong', () => {
    const result = scoreHookStrength({
      captionOrTitle: 'How I got 10k views in 3 days',
      viewCount: 10000,
      likeCount: 800,
      commentCount: 200,
    });
    expect(result.label).toBe('strong');
    expect(result.score).toBeGreaterThanOrEqual(70);
  });

  it('scores low engagement with a plain caption as weak', () => {
    const result = scoreHookStrength({
      captionOrTitle: 'My new video',
      viewCount: 10000,
      likeCount: 20,
      commentCount: 5,
    });
    expect(result.label).toBe('weak');
    expect(result.score).toBeLessThan(40);
  });

  it('always returns at least one reason explaining the score', () => {
    const result = scoreHookStrength({
      captionOrTitle: 'Untitled',
      viewCount: 100,
      likeCount: 1,
      commentCount: 0,
    });
    expect(result.reasons.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/diagnostic/hook-strength.test.ts`
Expected: FAIL with "Cannot find module '@/lib/diagnostic/hook-strength'"

- [ ] **Step 3: Write minimal implementation**
```ts
// lib/diagnostic/types.ts
export type ScoreLabel = 'weak' | 'moderate' | 'strong';

export interface ScoreResult {
  score: number;
  label: ScoreLabel;
  reasons: string[];
}

export function labelForScore(score: number): ScoreLabel {
  if (score >= 70) return 'strong';
  if (score >= 40) return 'moderate';
  return 'weak';
}
```
```ts
// lib/diagnostic/hook-strength.ts
import { labelForScore, type ScoreResult } from './types';

export interface HookStrengthInput {
  captionOrTitle: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
}

const HOOK_PATTERN = /(\?|\bhow\b|\bwhy\b|\bwait\b|\bstop\b|\d+)/i;

export function scoreHookStrength(input: HookStrengthInput): ScoreResult {
  const views = Math.max(input.viewCount, 1);
  const engagementRate = (input.likeCount + input.commentCount) / views;
  const hasHookPattern = HOOK_PATTERN.test(input.captionOrTitle);

  let score = Math.min(engagementRate * 1000, 70);
  const reasons: string[] = [];

  if (engagementRate >= 0.05) {
    reasons.push('Your engagement rate (likes and comments compared to views) is high, which usually means the opening kept people interested enough to react.');
  } else if (engagementRate >= 0.02) {
    reasons.push('Your engagement rate is moderate, suggesting the opening held some but not most viewers.');
  } else {
    reasons.push('Your engagement rate is low, which often means viewers scrolled or clicked away before the hook landed.');
  }

  if (hasHookPattern) {
    score += 20;
    reasons.push('Your title or caption uses a curiosity pattern (a question, a number, or a "how/why") that tends to earn a stronger hook.');
  } else {
    reasons.push('Your title or caption does not use an obvious curiosity pattern (a question, a number, or a "how/why"), which can make the first few seconds less compelling.');
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  return { score, label: labelForScore(score), reasons };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/diagnostic/hook-strength.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add lib/diagnostic/types.ts lib/diagnostic/hook-strength.ts tests/unit/lib/diagnostic/hook-strength.test.ts
git commit -m "feat: add hook strength scoring dimension"
```

---

### Task 18: Diagnostic scoring — retention risk

**Files:**
- Create: `lib/diagnostic/retention-risk.ts`
- Test: `tests/unit/lib/diagnostic/retention-risk.test.ts`

**Interfaces:**
- Consumes: `ScoreResult`, `labelForScore` from `@/lib/diagnostic/types` (Task 17)
- Produces: `RetentionRiskInput`, `scoreRetentionRisk(input)` — relied on by `lib/diagnostic/report.ts` (Task 22)

- [ ] **Step 1: Write the failing test**
```ts
// tests/unit/lib/diagnostic/retention-risk.test.ts
import { describe, it, expect } from 'vitest';
import { scoreRetentionRisk } from '@/lib/diagnostic/retention-risk';

describe('scoreRetentionRisk', () => {
  it('scores a well-paced, well-engaged TikTok clip as strong', () => {
    const result = scoreRetentionRisk({
      platform: 'tiktok',
      durationSeconds: 28,
      viewCount: 10000,
      likeCount: 900,
      commentCount: 100,
    });
    expect(result.label).toBe('strong');
  });

  it('scores an overly long TikTok clip with weak engagement as weak', () => {
    const result = scoreRetentionRisk({
      platform: 'tiktok',
      durationSeconds: 180,
      viewCount: 10000,
      likeCount: 30,
      commentCount: 5,
    });
    expect(result.label).toBe('weak');
  });

  it('returns two reasons covering duration and engagement', () => {
    const result = scoreRetentionRisk({
      platform: 'youtube',
      durationSeconds: 480,
      viewCount: 5000,
      likeCount: 200,
      commentCount: 40,
    });
    expect(result.reasons).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/diagnostic/retention-risk.test.ts`
Expected: FAIL with "Cannot find module '@/lib/diagnostic/retention-risk'"

- [ ] **Step 3: Write minimal implementation**
```ts
// lib/diagnostic/retention-risk.ts
import { labelForScore, type ScoreResult } from './types';

export interface RetentionRiskInput {
  platform: 'youtube' | 'tiktok' | 'instagram';
  durationSeconds: number;
  viewCount: number;
  likeCount: number;
  commentCount: number;
}

const IDEAL_DURATION_SECONDS: Record<RetentionRiskInput['platform'], number> = {
  tiktok: 30,
  instagram: 30,
  youtube: 480,
};

export function scoreRetentionRisk(input: RetentionRiskInput): ScoreResult {
  const ideal = IDEAL_DURATION_SECONDS[input.platform];
  const durationRatio = input.durationSeconds / ideal;
  const durationPenalty = Math.min(Math.abs(1 - durationRatio) * 40, 40);

  const views = Math.max(input.viewCount, 1);
  const engagementRate = (input.likeCount + input.commentCount) / views;
  const engagementScore = Math.min(engagementRate * 1000, 60);

  const score = Math.max(0, Math.min(100, Math.round(60 - durationPenalty + engagementScore)));

  const reasons: string[] = [];
  if (durationRatio > 1.5) {
    reasons.push(`Your video runs longer than what tends to hold attention on ${input.platform} for this format, which raises the risk viewers drop off before the end.`);
  } else if (durationRatio < 0.5) {
    reasons.push(`Your video is much shorter than the typical length that performs well on ${input.platform}, which can leave your message unfinished for viewers.`);
  } else {
    reasons.push(`Your video's length is close to what tends to hold attention on ${input.platform}, which lowers the risk of viewers dropping off early.`);
  }

  if (engagementRate >= 0.05) {
    reasons.push('Strong engagement (likes and comments relative to views) usually correlates with people watching further into the video.');
  } else {
    reasons.push('Lower engagement (likes and comments relative to views) often correlates with viewers not watching far enough to react.');
  }

  return { score, label: labelForScore(score), reasons };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/diagnostic/retention-risk.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add lib/diagnostic/retention-risk.ts tests/unit/lib/diagnostic/retention-risk.test.ts
git commit -m "feat: add retention risk scoring dimension"
```

---

### Task 19: Diagnostic scoring — timing

**Files:**
- Create: `lib/diagnostic/timing.ts`
- Test: `tests/unit/lib/diagnostic/timing.test.ts`

**Interfaces:**
- Consumes: `ScoreResult`, `labelForScore` from `@/lib/diagnostic/types` (Task 17)
- Produces: `TimingInput`, `scoreTiming(input)` — relied on by `lib/diagnostic/report.ts` (Task 22)

- [ ] **Step 1: Write the failing test**
```ts
// tests/unit/lib/diagnostic/timing.test.ts
import { describe, it, expect } from 'vitest';
import { scoreTiming } from '@/lib/diagnostic/timing';

describe('scoreTiming', () => {
  it('scores a post inside a known peak window as strong', () => {
    // 2026-08-11 is a Tuesday (UTC day 2); 19:00 UTC is within the TikTok peak window.
    const result = scoreTiming({ platform: 'tiktok', publishedAt: '2026-08-11T19:00:00Z' });
    expect(result.score).toBe(100);
    expect(result.label).toBe('strong');
  });

  it('scores a post far from any peak window lower', () => {
    // 2026-08-12 is a Wednesday (UTC day 3); 04:00 UTC is far from all TikTok peak windows.
    const result = scoreTiming({ platform: 'tiktok', publishedAt: '2026-08-12T04:00:00Z' });
    expect(result.score).toBeLessThan(100);
  });

  it('explains the timing reason in plain English', () => {
    const result = scoreTiming({ platform: 'youtube', publishedAt: '2026-08-14T10:00:00Z' });
    expect(result.reasons[0]).toContain('youtube');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/diagnostic/timing.test.ts`
Expected: FAIL with "Cannot find module '@/lib/diagnostic/timing'"

- [ ] **Step 3: Write minimal implementation**
```ts
// lib/diagnostic/timing.ts
import { labelForScore, type ScoreResult } from './types';

export interface TimingInput {
  platform: 'youtube' | 'tiktok' | 'instagram';
  publishedAt: string;
}

interface PeakWindow {
  dayOfWeek: number; // 0 = Sunday (UTC)
  startHour: number; // UTC hour, inclusive
  endHour: number; // UTC hour, exclusive
}

const PEAK_WINDOWS: Record<TimingInput['platform'], PeakWindow[]> = {
  tiktok: [
    { dayOfWeek: 2, startHour: 18, endHour: 22 },
    { dayOfWeek: 4, startHour: 18, endHour: 22 },
    { dayOfWeek: 6, startHour: 10, endHour: 14 },
  ],
  instagram: [
    { dayOfWeek: 1, startHour: 17, endHour: 21 },
    { dayOfWeek: 3, startHour: 17, endHour: 21 },
    { dayOfWeek: 5, startHour: 11, endHour: 14 },
  ],
  youtube: [
    { dayOfWeek: 5, startHour: 14, endHour: 18 },
    { dayOfWeek: 6, startHour: 9, endHour: 12 },
    { dayOfWeek: 0, startHour: 9, endHour: 12 },
  ],
};

function hoursFromWindow(hour: number, window: PeakWindow): number {
  if (hour >= window.startHour && hour < window.endHour) return 0;
  const distanceToStart = Math.min(Math.abs(hour - window.startHour), 24 - Math.abs(hour - window.startHour));
  const distanceToEnd = Math.min(Math.abs(hour - window.endHour), 24 - Math.abs(hour - window.endHour));
  return Math.min(distanceToStart, distanceToEnd);
}

export function scoreTiming(input: TimingInput): ScoreResult {
  const published = new Date(input.publishedAt);
  const dayOfWeek = published.getUTCDay();
  const hour = published.getUTCHours();
  const windows = PEAK_WINDOWS[input.platform];

  let bestDistance = Infinity;
  for (const window of windows) {
    const dayDistance = Math.min(Math.abs(dayOfWeek - window.dayOfWeek), 7 - Math.abs(dayOfWeek - window.dayOfWeek));
    const hourDistance = hoursFromWindow(hour, window);
    bestDistance = Math.min(bestDistance, dayDistance * 24 + hourDistance);
  }

  const score = Math.max(0, Math.min(100, Math.round(100 - bestDistance * 4)));
  const reasons: string[] =
    bestDistance === 0
      ? [`You posted during one of the windows when ${input.platform} audiences are typically most active, giving your post a better chance at early views.`]
      : [`You posted outside the windows when ${input.platform} audiences are typically most active, which can mean fewer people see it in the first crucial hour.`];

  return { score, label: labelForScore(score), reasons };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/diagnostic/timing.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add lib/diagnostic/timing.ts tests/unit/lib/diagnostic/timing.test.ts
git commit -m "feat: add posting timing scoring dimension"
```

---

### Task 20: Diagnostic scoring — format fit

**Files:**
- Create: `lib/diagnostic/format-fit.ts`
- Test: `tests/unit/lib/diagnostic/format-fit.test.ts`

**Interfaces:**
- Consumes: `ScoreResult`, `labelForScore` from `@/lib/diagnostic/types` (Task 17)
- Produces: `FormatFitInput`, `scoreFormatFit(input)` — relied on by `lib/diagnostic/report.ts` (Task 22)

- [ ] **Step 1: Write the failing test**
```ts
// tests/unit/lib/diagnostic/format-fit.test.ts
import { describe, it, expect } from 'vitest';
import { scoreFormatFit } from '@/lib/diagnostic/format-fit';

describe('scoreFormatFit', () => {
  it('scores a TikTok video within the ideal range as strong', () => {
    const result = scoreFormatFit({ platform: 'tiktok', durationSeconds: 30 });
    expect(result.score).toBe(100);
    expect(result.label).toBe('strong');
  });

  it('scores a TikTok video far outside the ideal range as weak', () => {
    const result = scoreFormatFit({ platform: 'tiktok', durationSeconds: 300 });
    expect(result.label).toBe('weak');
  });

  it('scores a YouTube video within the ideal long-form range as strong', () => {
    const result = scoreFormatFit({ platform: 'youtube', durationSeconds: 600 });
    expect(result.score).toBe(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/diagnostic/format-fit.test.ts`
Expected: FAIL with "Cannot find module '@/lib/diagnostic/format-fit'"

- [ ] **Step 3: Write minimal implementation**
```ts
// lib/diagnostic/format-fit.ts
import { labelForScore, type ScoreResult } from './types';

export interface FormatFitInput {
  platform: 'youtube' | 'tiktok' | 'instagram';
  durationSeconds: number;
}

interface DurationRange {
  minSeconds: number;
  maxSeconds: number;
}

const IDEAL_RANGES: Record<FormatFitInput['platform'], DurationRange> = {
  tiktok: { minSeconds: 15, maxSeconds: 60 },
  instagram: { minSeconds: 15, maxSeconds: 90 },
  youtube: { minSeconds: 240, maxSeconds: 900 },
};

export function scoreFormatFit(input: FormatFitInput): ScoreResult {
  const range = IDEAL_RANGES[input.platform];
  const reasons: string[] = [];
  let score: number;

  if (input.durationSeconds >= range.minSeconds && input.durationSeconds <= range.maxSeconds) {
    score = 100;
    reasons.push(`Your video's length fits squarely in the range that performs well for ${input.platform}.`);
  } else {
    const distance =
      input.durationSeconds < range.minSeconds
        ? range.minSeconds - input.durationSeconds
        : input.durationSeconds - range.maxSeconds;
    score = Math.max(0, 100 - distance * 2);
    reasons.push(
      input.durationSeconds < range.minSeconds
        ? `Your video is shorter than the range that tends to work well for ${input.platform}, which can limit how much story or value you deliver.`
        : `Your video is longer than the range that tends to work well for ${input.platform}, which raises the chance viewers leave before it ends.`
    );
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, label: labelForScore(score), reasons };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/diagnostic/format-fit.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add lib/diagnostic/format-fit.ts tests/unit/lib/diagnostic/format-fit.test.ts
git commit -m "feat: add format fit scoring dimension"
```

---

### Task 21: Diagnostic scoring — combine scores

**Files:**
- Create: `lib/diagnostic/score.ts`
- Test: `tests/unit/lib/diagnostic/score.test.ts`

**Interfaces:**
- Consumes: `ScoreResult` from `@/lib/diagnostic/types` (Task 17)
- Produces: `CombinedScoreInput`, `CombinedScore`, `combineScores(input)` — relied on by `lib/diagnostic/report.ts` (Task 22)

- [ ] **Step 1: Write the failing test**
```ts
// tests/unit/lib/diagnostic/score.test.ts
import { describe, it, expect } from 'vitest';
import { combineScores } from '@/lib/diagnostic/score';
import type { ScoreResult } from '@/lib/diagnostic/types';

function makeScore(score: number): ScoreResult {
  return { score, label: score >= 70 ? 'strong' : score >= 40 ? 'moderate' : 'weak', reasons: ['reason'] };
}

describe('combineScores', () => {
  it('computes a weighted overall score', () => {
    const result = combineScores({
      hookStrength: makeScore(80),
      retentionRisk: makeScore(80),
      timing: makeScore(80),
      formatFit: makeScore(80),
    });
    expect(result.overallScore).toBe(80);
  });

  it('weighs hook strength and retention risk more heavily than timing and format fit', () => {
    const highHookLowOthers = combineScores({
      hookStrength: makeScore(100),
      retentionRisk: makeScore(100),
      timing: makeScore(0),
      formatFit: makeScore(0),
    });
    const lowHookHighOthers = combineScores({
      hookStrength: makeScore(0),
      retentionRisk: makeScore(0),
      timing: makeScore(100),
      formatFit: makeScore(100),
    });
    expect(highHookLowOthers.overallScore).toBeGreaterThan(lowHookHighOthers.overallScore);
  });

  it('preserves the individual dimension scores on the combined result', () => {
    const result = combineScores({
      hookStrength: makeScore(60),
      retentionRisk: makeScore(60),
      timing: makeScore(60),
      formatFit: makeScore(60),
    });
    expect(result.hookStrength.score).toBe(60);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/diagnostic/score.test.ts`
Expected: FAIL with "Cannot find module '@/lib/diagnostic/score'"

- [ ] **Step 3: Write minimal implementation**
```ts
// lib/diagnostic/score.ts
import type { ScoreResult } from './types';

export interface CombinedScoreInput {
  hookStrength: ScoreResult;
  retentionRisk: ScoreResult;
  timing: ScoreResult;
  formatFit: ScoreResult;
}

export interface CombinedScore extends CombinedScoreInput {
  overallScore: number;
}

const WEIGHTS = {
  hookStrength: 0.3,
  retentionRisk: 0.3,
  timing: 0.2,
  formatFit: 0.2,
};

export function combineScores(input: CombinedScoreInput): CombinedScore {
  const overallScore = Math.round(
    input.hookStrength.score * WEIGHTS.hookStrength +
      input.retentionRisk.score * WEIGHTS.retentionRisk +
      input.timing.score * WEIGHTS.timing +
      input.formatFit.score * WEIGHTS.formatFit
  );

  return { ...input, overallScore };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/diagnostic/score.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add lib/diagnostic/score.ts tests/unit/lib/diagnostic/score.test.ts
git commit -m "feat: add weighted score combination for the diagnostic engine"
```

---

### Task 22: Report generation glue (scoring + Claude + glossary)

**Files:**
- Create: `lib/diagnostic/report.ts`
- Test: `tests/unit/lib/diagnostic/report.test.ts`

**Interfaces:**
- Consumes: `scoreHookStrength` (Task 17), `scoreRetentionRisk` (Task 18), `scoreTiming` (Task 19), `scoreFormatFit` (Task 20), `combineScores`/`CombinedScore` (Task 21), `ClaudeReportClient` (Task 16), `linkGlossaryTerms`/`getGlossaryTerms`/`GlossarySegment`/`GlossaryTerm` (Task 10), `createFakeClaudeReportClient` (Task 16, test only)
- Produces: `DiagnosticPostStats`, `GenerateDiagnosticReportParams`, `DiagnosticReport`, `generateDiagnosticReport(params)` — relied on by `lib/diagnostic/handler.ts` (Task 23)

- [ ] **Step 1: Write the failing test**
```ts
// tests/unit/lib/diagnostic/report.test.ts
import { describe, it, expect } from 'vitest';
import { generateDiagnosticReport } from '@/lib/diagnostic/report';
import { createFakeClaudeReportClient } from '../../../fakes/claude.fake';

describe('generateDiagnosticReport', () => {
  it('combines scoring, the Claude client, and glossary linking into a full report', async () => {
    const claudeClient = createFakeClaudeReportClient({
      headline: 'Strong hook, watch your pacing',
      explanation: 'Your hook rate is strong and your retention looks solid for this format.',
    });

    const report = await generateDiagnosticReport({
      platform: 'tiktok',
      postStats: {
        captionOrTitle: 'How I hit 10k views overnight',
        publishedAt: '2026-08-11T19:00:00Z',
        durationSeconds: 28,
        viewCount: 12000,
        likeCount: 1000,
        commentCount: 150,
      },
      claudeClient,
    });

    expect(report.headline).toBe('Strong hook, watch your pacing');
    expect(report.scores.overallScore).toBeGreaterThan(0);
    expect(report.explanationSegments.some((s) => s.type === 'term')).toBe(true);
    expect(report.glossaryTerms.some((t) => t.slug === 'hook-rate')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/diagnostic/report.test.ts`
Expected: FAIL with "Cannot find module '@/lib/diagnostic/report'"

- [ ] **Step 3: Write minimal implementation**
```ts
// lib/diagnostic/report.ts
import { scoreHookStrength, type HookStrengthInput } from './hook-strength';
import { scoreRetentionRisk, type RetentionRiskInput } from './retention-risk';
import { scoreTiming, type TimingInput } from './timing';
import { scoreFormatFit, type FormatFitInput } from './format-fit';
import { combineScores, type CombinedScore } from './score';
import type { ClaudeReportClient } from '@/lib/integrations/claude';
import { linkGlossaryTerms, getGlossaryTerms, type GlossarySegment, type GlossaryTerm } from '@/lib/glossary';

export interface DiagnosticPostStats {
  captionOrTitle: string;
  publishedAt: string;
  durationSeconds: number;
  viewCount: number;
  likeCount: number;
  commentCount: number;
}

export interface GenerateDiagnosticReportParams {
  platform: 'youtube' | 'tiktok' | 'instagram';
  postStats: DiagnosticPostStats;
  claudeClient: ClaudeReportClient;
}

export interface DiagnosticReport {
  scores: CombinedScore;
  headline: string;
  explanationSegments: GlossarySegment[];
  glossaryTerms: GlossaryTerm[];
}

export async function generateDiagnosticReport(params: GenerateDiagnosticReportParams): Promise<DiagnosticReport> {
  const { platform, postStats } = params;

  const hookStrengthInput: HookStrengthInput = {
    captionOrTitle: postStats.captionOrTitle,
    viewCount: postStats.viewCount,
    likeCount: postStats.likeCount,
    commentCount: postStats.commentCount,
  };
  const retentionRiskInput: RetentionRiskInput = {
    platform,
    durationSeconds: postStats.durationSeconds,
    viewCount: postStats.viewCount,
    likeCount: postStats.likeCount,
    commentCount: postStats.commentCount,
  };
  const timingInput: TimingInput = { platform, publishedAt: postStats.publishedAt };
  const formatFitInput: FormatFitInput = { platform, durationSeconds: postStats.durationSeconds };

  const scores = combineScores({
    hookStrength: scoreHookStrength(hookStrengthInput),
    retentionRisk: scoreRetentionRisk(retentionRiskInput),
    timing: scoreTiming(timingInput),
    formatFit: scoreFormatFit(formatFitInput),
  });

  const generated = await params.claudeClient.generateDiagnosticReport({
    platform,
    postSummary: postStats.captionOrTitle,
    scores: {
      hookStrength: { value: scores.hookStrength.score, label: scores.hookStrength.label },
      retentionRisk: { value: scores.retentionRisk.score, label: scores.retentionRisk.label },
      timing: { value: scores.timing.score, label: scores.timing.label },
      formatFit: { value: scores.formatFit.score, label: scores.formatFit.label },
    },
  });

  const allTerms = getGlossaryTerms();
  const explanationSegments = linkGlossaryTerms(generated.explanation, allTerms);
  const glossaryTerms = allTerms.filter((term) =>
    explanationSegments.some((segment) => segment.type === 'term' && segment.term.slug === term.slug)
  );

  return {
    scores,
    headline: generated.headline,
    explanationSegments,
    glossaryTerms,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/diagnostic/report.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add lib/diagnostic/report.ts tests/unit/lib/diagnostic/report.test.ts
git commit -m "feat: glue scoring, Claude, and glossary linking into report generation"
```

---

### Task 23: Diagnostic API route handler + POST route

**Files:**
- Create: `lib/diagnostic/handler.ts`
- Create: `app/api/diagnostic/route.ts`
- Test: `tests/unit/lib/diagnostic/handler.test.ts`

**Interfaces:**
- Consumes: `RateLimitStore`/`checkRateLimit`/`recordRateLimitEvent`/`hashIp` (Task 12), `createSupabaseRateLimitStore` (Task 13), `YouTubeClient`/`createYouTubeClient` (Task 14), `ScraperClient`/`createApifyScraperClient` (Task 15), `ClaudeReportClient`/`createClaudeReportClient` (Task 16), `generateDiagnosticReport`/`DiagnosticReport` (Task 22), `createSupabaseServerClient`/`createSupabaseServiceRoleClient` (Task 9), fakes from Tasks 12/14/15/16
- Produces: `DiagnosticHandlerDeps`, `DiagnosticRequestContext`, `DiagnosticHandlerResult`, `handleDiagnosticRequest(deps, context)` — relied on by `app/api/diagnostic/route.ts` (this task) and exercised end-to-end by the Playwright test (Task 27)

- [ ] **Step 1: Write the failing test**
```ts
// tests/unit/lib/diagnostic/handler.test.ts
import { describe, it, expect } from 'vitest';
import { handleDiagnosticRequest } from '@/lib/diagnostic/handler';
import { createInMemoryRateLimitStore } from '../../../fakes/rate-limit-store.fake';
import { createFakeYouTubeClient } from '../../../fakes/youtube.fake';
import { createFakeScraperClient } from '../../../fakes/scraper.fake';
import { createFakeClaudeReportClient } from '../../../fakes/claude.fake';

function makeDeps(overrides: Partial<Parameters<typeof handleDiagnosticRequest>[0]> = {}) {
  return {
    rateLimitStore: createInMemoryRateLimitStore(),
    youtubeClient: createFakeYouTubeClient(),
    scraperClient: createFakeScraperClient(),
    claudeClient: createFakeClaudeReportClient(),
    ipSalt: 'test-salt',
    saveDiagnostic: async () => ({ id: 'diagnostic-1' }),
    ...overrides,
  };
}

describe('handleDiagnosticRequest', () => {
  it('rejects requests without a signed-in profile', async () => {
    const result = await handleDiagnosticRequest(makeDeps(), {
      profileId: null,
      ip: '203.0.113.1',
      url: 'https://www.youtube.com/watch?v=abc123',
    });
    expect(result.status).toBe(401);
  });

  it('returns a generated report for a valid YouTube URL', async () => {
    const result = await handleDiagnosticRequest(makeDeps(), {
      profileId: 'profile-1',
      ip: '203.0.113.1',
      url: 'https://www.youtube.com/watch?v=abc123',
    });
    expect(result.status).toBe(200);
    expect(result.body.id).toBe('diagnostic-1');
  });

  it('returns a generated report for a valid TikTok URL', async () => {
    const result = await handleDiagnosticRequest(makeDeps(), {
      profileId: 'profile-1',
      ip: '203.0.113.1',
      url: 'https://www.tiktok.com/@user/video/123',
    });
    expect(result.status).toBe(200);
  });

  it('rejects an unsupported URL', async () => {
    const result = await handleDiagnosticRequest(makeDeps(), {
      profileId: 'profile-1',
      ip: '203.0.113.1',
      url: 'https://example.com/post',
    });
    expect(result.status).toBe(400);
  });

  it('rate-limits a second request from the same profile within 30 days', async () => {
    const deps = makeDeps();
    await handleDiagnosticRequest(deps, {
      profileId: 'profile-1',
      ip: '203.0.113.1',
      url: 'https://www.youtube.com/watch?v=abc123',
    });
    const second = await handleDiagnosticRequest(deps, {
      profileId: 'profile-1',
      ip: '203.0.113.1',
      url: 'https://www.youtube.com/watch?v=abc123',
    });
    expect(second.status).toBe(429);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/diagnostic/handler.test.ts`
Expected: FAIL with "Cannot find module '@/lib/diagnostic/handler'"

- [ ] **Step 3: Write minimal implementation**
```ts
// lib/diagnostic/handler.ts
import type { RateLimitStore } from '@/lib/rate-limit';
import { checkRateLimit, recordRateLimitEvent, hashIp } from '@/lib/rate-limit';
import type { YouTubeClient } from '@/lib/integrations/youtube';
import type { ScraperClient } from '@/lib/integrations/scraper';
import type { ClaudeReportClient } from '@/lib/integrations/claude';
import { generateDiagnosticReport, type DiagnosticReport } from '@/lib/diagnostic/report';

export interface DiagnosticHandlerDeps {
  rateLimitStore: RateLimitStore;
  youtubeClient: YouTubeClient;
  scraperClient: ScraperClient;
  claudeClient: ClaudeReportClient;
  ipSalt: string;
  saveDiagnostic: (params: {
    profileId: string;
    platform: 'youtube' | 'tiktok' | 'instagram';
    inputUrl: string;
    report: DiagnosticReport;
  }) => Promise<{ id: string }>;
}

export interface DiagnosticRequestContext {
  profileId: string | null;
  ip: string;
  url: string;
}

export interface DiagnosticHandlerResult {
  status: number;
  body: Record<string, unknown>;
}

export async function handleDiagnosticRequest(
  deps: DiagnosticHandlerDeps,
  context: DiagnosticRequestContext
): Promise<DiagnosticHandlerResult> {
  if (!context.profileId) {
    return { status: 401, body: { error: 'You must be signed in to run a diagnostic.' } };
  }

  const ipHash = hashIp(context.ip, deps.ipSalt);
  const rateLimitResult = await checkRateLimit({
    store: deps.rateLimitStore,
    profileId: context.profileId,
    ipHash,
    eventType: 'diagnostic_request',
  });

  if (!rateLimitResult.allowed) {
    return {
      status: 429,
      body: {
        error:
          rateLimitResult.reason === 'ip_limit'
            ? 'Too many diagnostics have been requested from this network recently. Please try again later.'
            : 'You have already used your free diagnostic for this 30-day period.',
        retryAfter: rateLimitResult.retryAfter?.toISOString(),
      },
    };
  }

  let platform: 'youtube' | 'tiktok' | 'instagram' | null = null;
  let postStats: Parameters<typeof generateDiagnosticReport>[0]['postStats'] | null = null;

  const youtubeId = deps.youtubeClient.extractVideoId(context.url);
  if (youtubeId) {
    platform = 'youtube';
    const metadata = await deps.youtubeClient.getVideoMetadata(youtubeId);
    postStats = {
      captionOrTitle: metadata.title,
      publishedAt: metadata.publishedAt,
      durationSeconds: metadata.durationSeconds,
      viewCount: metadata.viewCount,
      likeCount: metadata.likeCount,
      commentCount: metadata.commentCount,
    };
  } else {
    const detected = deps.scraperClient.detectPlatform(context.url);
    if (!detected) {
      return { status: 400, body: { error: 'That link is not a supported YouTube, TikTok, or Instagram URL.' } };
    }
    platform = detected;
    const post = await deps.scraperClient.fetchPost(context.url);
    postStats = {
      captionOrTitle: post.caption,
      publishedAt: post.publishedAt,
      durationSeconds: post.durationSeconds,
      viewCount: post.viewCount,
      likeCount: post.likeCount,
      commentCount: post.commentCount,
    };
  }

  const report = await generateDiagnosticReport({ platform, postStats, claudeClient: deps.claudeClient });
  const saved = await deps.saveDiagnostic({ profileId: context.profileId, platform, inputUrl: context.url, report });
  await recordRateLimitEvent({ store: deps.rateLimitStore, profileId: context.profileId, ipHash, eventType: 'diagnostic_request' });

  return { status: 200, body: { id: saved.id, report } };
}
```
```ts
// app/api/diagnostic/route.ts
import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { createSupabaseRateLimitStore } from '@/lib/supabase/rate-limit-store';
import { createYouTubeClient } from '@/lib/integrations/youtube';
import { createApifyScraperClient } from '@/lib/integrations/scraper';
import { createClaudeReportClient } from '@/lib/integrations/claude';
import { handleDiagnosticRequest } from '@/lib/diagnostic/handler';

export async function POST(request: Request) {
  const { url } = (await request.json()) as { url?: string };
  if (!url) {
    return NextResponse.json({ error: 'A post or video URL is required.' }, { status: 400 });
  }

  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const serviceClient = createSupabaseServiceRoleClient();
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '0.0.0.0';

  const result = await handleDiagnosticRequest(
    {
      rateLimitStore: createSupabaseRateLimitStore(serviceClient),
      youtubeClient: createYouTubeClient(process.env.YOUTUBE_API_KEY ?? ''),
      scraperClient: createApifyScraperClient(process.env.APIFY_API_TOKEN ?? ''),
      claudeClient: createClaudeReportClient(process.env.ANTHROPIC_API_KEY ?? ''),
      ipSalt: process.env.RATE_LIMIT_IP_SALT ?? 'dev-salt',
      saveDiagnostic: async ({ profileId, platform, inputUrl, report }) => {
        const { data, error } = await serviceClient
          .from('diagnostics')
          .insert({
            profile_id: profileId,
            platform,
            input_url: inputUrl,
            status: 'complete',
            hook_strength_score: report.scores.hookStrength.score,
            retention_risk_score: report.scores.retentionRisk.score,
            timing_score: report.scores.timing.score,
            format_fit_score: report.scores.formatFit.score,
            overall_score: report.scores.overallScore,
            report_json: report,
          })
          .select('id')
          .single();
        if (error || !data) {
          throw new Error(`Failed to save diagnostic: ${error?.message}`);
        }
        return { id: data.id };
      },
    },
    { profileId: user?.id ?? null, ip, url }
  );

  return NextResponse.json(result.body, { status: result.status });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/diagnostic/handler.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add lib/diagnostic/handler.ts app/api/diagnostic/route.ts tests/unit/lib/diagnostic/handler.test.ts
git commit -m "feat: add diagnostic request handler and POST /api/diagnostic route"
```

---

### Task 24: Landing page `/`

**Files:**
- Modify: `app/page.tsx` (replaces the Task 1 placeholder)
- Test: `tests/unit/app/page.test.tsx`

**Interfaces:**
- Consumes: `next/link`
- Produces: `HomePage` default export linking to `/diagnostic`

- [ ] **Step 1: Write the failing test**
```tsx
// tests/unit/app/page.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import HomePage from '@/app/page';

describe('HomePage', () => {
  it('links to the diagnostic page', () => {
    render(<HomePage />);
    const link = screen.getByRole('link', { name: /run a free diagnostic/i });
    expect(link).toHaveAttribute('href', '/diagnostic');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/app/page.test.tsx`
Expected: FAIL — no element with role "link" and accessible name matching /run a free diagnostic/i (current placeholder has no link)

- [ ] **Step 3: Write minimal implementation**
```tsx
// app/page.tsx
import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col items-center gap-6 px-6 py-24 text-center">
      <h1 className="text-4xl font-bold text-gray-900">
        Understand your content, in plain English.
      </h1>
      <p className="text-lg text-gray-600">
        Paste a link to a video or post and get a report on your hook, your retention risk,
        your posting timing, and your format fit &mdash; explained in words you actually
        understand, not jargon.
      </p>
      <Link
        href="/diagnostic"
        className="rounded-full bg-indigo-600 px-8 py-3 text-lg font-semibold text-white hover:bg-indigo-700"
      >
        Run a free diagnostic
      </Link>
    </main>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/app/page.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add app/page.tsx tests/unit/app/page.test.tsx
git commit -m "feat: build the landing page"
```

---

### Task 25: Diagnostic input page `/diagnostic`

**Files:**
- Create: `app/diagnostic/page.tsx`
- Test: `tests/unit/app/diagnostic/page.test.tsx`

**Interfaces:**
- Consumes: `POST /api/diagnostic` (Task 23) response shape `{ id: string }` on success, `{ error: string }` on failure; `next/navigation`'s `useRouter`
- Produces: `DiagnosticInputPage` default export — the entry point exercised by the Playwright test (Task 27)

- [ ] **Step 1: Write the failing test**
```tsx
// tests/unit/app/diagnostic/page.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

import DiagnosticInputPage from '@/app/diagnostic/page';

describe('DiagnosticInputPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    pushMock.mockClear();
  });

  it('submits the pasted URL and navigates to the report page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'diagnostic-1', report: {} }) })
    );
    render(<DiagnosticInputPage />);
    fireEvent.change(screen.getByLabelText(/paste a youtube, tiktok, or instagram link/i), {
      target: { value: 'https://www.tiktok.com/@user/video/123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /get my report/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/diagnostic/diagnostic-1'));
  });

  it('shows an error message when the request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'You have already used your free diagnostic for this 30-day period.' }),
      })
    );
    render(<DiagnosticInputPage />);
    fireEvent.change(screen.getByLabelText(/paste a youtube, tiktok, or instagram link/i), {
      target: { value: 'https://www.tiktok.com/@user/video/123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /get my report/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('already used your free diagnostic'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/app/diagnostic/page.test.tsx`
Expected: FAIL with "Cannot find module '@/app/diagnostic/page'"

- [ ] **Step 3: Write minimal implementation**
```tsx
// app/diagnostic/page.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function DiagnosticInputPage() {
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch('/api/diagnostic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? 'Something went wrong. Please try again.');
        return;
      }
      router.push(`/diagnostic/${data.id}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-6 py-16">
      <h1 className="text-2xl font-bold text-gray-900">Run a diagnostic</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label htmlFor="url" className="text-sm font-medium text-gray-700">
          Paste a YouTube, TikTok, or Instagram link
        </label>
        <input
          id="url"
          name="url"
          type="url"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.tiktok.com/@you/video/..."
          className="rounded-lg border border-gray-300 px-4 py-2"
        />
        <button
          type="submit"
          disabled={submitting}
          className="rounded-full bg-indigo-600 px-6 py-3 font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {submitting ? 'Analyzing…' : 'Get my report'}
        </button>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
      </form>
    </main>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/app/diagnostic/page.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add app/diagnostic/page.tsx tests/unit/app/diagnostic/page.test.tsx
git commit -m "feat: build the diagnostic input page"
```

---

### Task 26: Diagnostic report page + report-by-id API route

**Files:**
- Create: `app/api/diagnostic/[id]/route.ts`
- Create: `app/diagnostic/[id]/page.tsx`
- Test: `tests/unit/app/diagnostic/id-page.test.tsx`

**Interfaces:**
- Consumes: `createSupabaseServerClient` (Task 9), `GlossaryText` (Task 11), `next/navigation`'s `useParams`
- Produces: `GET /api/diagnostic/[id]` returning `{ diagnostic: { report_json: DiagnosticReport, ... } }` or `{ error }`; `DiagnosticReportPage` default export — both exercised by the Playwright test (Task 27) via mocked `fetch`

- [ ] **Step 1: Write the failing test**
```tsx
// tests/unit/app/diagnostic/id-page.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'diagnostic-1' }),
}));

import DiagnosticReportPage from '@/app/diagnostic/[id]/page';

describe('DiagnosticReportPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the headline, score, and explanation with linked glossary terms', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({
          diagnostic: {
            report_json: {
              headline: 'Strong hook, moderate retention',
              scores: { overallScore: 72 },
              explanationSegments: [
                { type: 'text', value: 'Your ' },
                { type: 'term', value: 'hook rate' },
                { type: 'text', value: ' is strong.' },
              ],
            },
          },
        }),
      })
    );

    render(<DiagnosticReportPage />);

    expect(screen.getByText(/loading your report/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Strong hook, moderate retention')).toBeInTheDocument());
    expect(screen.getByText(/overall score: 72/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'hook rate' })).toBeInTheDocument();
  });

  it('shows an error message when the diagnostic is not found', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ error: 'Diagnostic not found.' }) }));
    render(<DiagnosticReportPage />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Diagnostic not found.'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/app/diagnostic/id-page.test.tsx`
Expected: FAIL with "Cannot find module '@/app/diagnostic/[id]/page'"

- [ ] **Step 3: Write minimal implementation**
```ts
// app/api/diagnostic/[id]/route.ts
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.from('diagnostics').select('*').eq('id', params.id).single();

  if (error || !data) {
    return NextResponse.json({ error: 'Diagnostic not found.' }, { status: 404 });
  }

  return NextResponse.json({ diagnostic: data });
}
```
```tsx
// app/diagnostic/[id]/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { GlossaryText } from '@/components/GlossaryChip';

interface DiagnosticReportData {
  headline: string;
  scores: { overallScore: number };
  explanationSegments: Array<{ type: 'text' | 'term'; value: string }>;
}

export default function DiagnosticReportPage() {
  const params = useParams<{ id: string }>();
  const [report, setReport] = useState<DiagnosticReportData | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        setReport(data.diagnostic.report_json);
      });
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  if (error) {
    return <p role="alert">{error}</p>;
  }

  if (!report) {
    return <p>Loading your report…</p>;
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
      <h1 className="text-2xl font-bold text-gray-900">{report.headline}</h1>
      <p className="text-lg text-gray-700">Overall score: {report.scores.overallScore}</p>
      <div className="text-base leading-relaxed text-gray-800">
        <GlossaryText text={report.explanationSegments.map((s) => s.value).join('')} />
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/app/diagnostic/id-page.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add app/api/diagnostic/\[id\]/route.ts app/diagnostic/\[id\]/page.tsx tests/unit/app/diagnostic/id-page.test.tsx
git commit -m "feat: build the diagnostic report page and report-by-id API route"
```

---

### Task 27: Playwright E2E smoke test

**Files:**
- Test: `tests/e2e/diagnostic-smoke.spec.ts`

**Interfaces:**
- Consumes: `/diagnostic` (Task 25), `/diagnostic/[id]` (Task 26), `playwright.config.ts` (Task 2) — mocks both `POST /api/diagnostic` and `GET /api/diagnostic/[id]` at the browser network layer, so no real Supabase/YouTube/Apify/Claude calls occur and the dev server needs no live credentials
- Produces: nothing consumed by later tasks — this is the terminal verification of the diagnostic feature slice

- [ ] **Step 1: Write the E2E test**
```ts
// tests/e2e/diagnostic-smoke.spec.ts
import { test, expect } from '@playwright/test';

test('pasting a URL renders a diagnostic report', async ({ page }) => {
  await page.route('**/api/diagnostic', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'e2e-diagnostic-1' }),
    });
  });

  await page.route('**/api/diagnostic/e2e-diagnostic-1', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        diagnostic: {
          report_json: {
            headline: 'Strong hook, watch your pacing',
            scores: { overallScore: 76 },
            explanationSegments: [
              { type: 'text', value: 'Your ' },
              { type: 'term', value: 'hook rate' },
              { type: 'text', value: ' is strong for this format.' },
            ],
          },
        },
      }),
    });
  });

  await page.goto('/diagnostic');
  await page.getByLabel(/paste a youtube, tiktok, or instagram link/i).fill('https://www.tiktok.com/@user/video/123');
  await page.getByRole('button', { name: /get my report/i }).click();

  await expect(page).toHaveURL(/\/diagnostic\/e2e-diagnostic-1$/);
  await expect(page.getByRole('heading', { name: 'Strong hook, watch your pacing' })).toBeVisible();
  await expect(page.getByText('Overall score: 76')).toBeVisible();
  await expect(page.getByRole('button', { name: 'hook rate' })).toBeVisible();
});
```

- [ ] **Step 2: Run the test**

Run: `npm run build && npx playwright install --with-deps chromium && npm run test:e2e`
Expected: PASS — 1 test passed. (First run needs `playwright install`; the `webServer` block in `playwright.config.ts` starts `npm run dev` automatically.)

- [ ] **Step 3: Commit**
```bash
git add tests/e2e/diagnostic-smoke.spec.ts
git commit -m "test: add Playwright smoke test for the diagnostic flow"
```

---

### Task 28: `.env.example`, README dev setup, and Supabase/Vercel connection notes

**Files:**
- Create: `.env.example`
- Modify: `README.md`
- Test: `tests/unit/env.test.ts`

**Interfaces:**
- Consumes: every `process.env.*` reference introduced in Tasks 9, 13, 14, 15, 16, 23, 26
- Produces: nothing consumed by other tasks — this is the final, documentation-closing task

- [ ] **Step 1: Write the failing test**
```ts
// tests/unit/env.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('.env.example', () => {
  it('documents every environment variable referenced by the app', () => {
    const envExample = readFileSync(join(process.cwd(), '.env.example'), 'utf-8');
    const documentedKeys = [...envExample.matchAll(/^([A-Z0-9_]+)=/gm)].map((m) => m[1]);

    const requiredKeys = [
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'YOUTUBE_API_KEY',
      'APIFY_API_TOKEN',
      'ANTHROPIC_API_KEY',
      'RATE_LIMIT_IP_SALT',
    ];

    for (const key of requiredKeys) {
      expect(documentedKeys).toContain(key);
    }
  });
});

describe('README', () => {
  it('documents local dev setup and how to connect a real Supabase project', () => {
    const readme = readFileSync(join(process.cwd(), 'README.md'), 'utf-8');
    expect(readme).toContain('npm install');
    expect(readme).toContain('npm test');
    expect(readme.toLowerCase()).toContain('connecting a real supabase project');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/env.test.ts`
Expected: FAIL with "ENOENT: no such file or directory, open '.env.example'"

- [ ] **Step 3: Write the env template and README**
```
# .env.example

# Supabase — create a project later at https://supabase.com. Do NOT use any
# Supabase account/project connected to this coding session; see the
# "Connecting a real Supabase project" section in README.md.
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# YouTube Data API v3 — https://console.cloud.google.com/apis/library/youtube.googleapis.com
YOUTUBE_API_KEY=your-youtube-api-key

# Apify — https://console.apify.com/account/integrations (used for TikTok/Instagram scraping)
APIFY_API_TOKEN=your-apify-api-token

# Anthropic Claude API — https://console.anthropic.com/settings/keys
ANTHROPIC_API_KEY=your-anthropic-api-key

# Random string used to salt IP hashes for rate limiting (generate with `openssl rand -hex 32`)
RATE_LIMIT_IP_SALT=dev-salt-change-me
```
```markdown
<!-- Append to README.md -->

## Local development

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in placeholder values (the
   app builds, typechecks, and runs all tests without real credentials —
   real keys are only needed to exercise live external calls).
3. `npm run dev` — starts the app at http://localhost:3000
4. `npm test` — runs the Vitest unit/integration suite
5. `npm run test:e2e` — runs the Playwright smoke test (network calls mocked)
6. `npm run typecheck` / `npm run lint` / `npm run build` — full verification

## Connecting a real Supabase project

This repo intentionally contains no live Supabase or Vercel resources. When
ready to connect real infrastructure:

1. Create a new Supabase project at https://supabase.com (use a fresh
   account/project — do not reuse any project from an automated coding
   session).
2. Run the migrations in `supabase/migrations/` against it, either via the
   Supabase CLI (`supabase link --project-ref <ref>` then
   `supabase db push`) or by pasting each file's contents into the SQL
   Editor in order.
3. In the Supabase dashboard, copy the Project URL, anon key, and service
   role key into `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   and `SUPABASE_SERVICE_ROLE_KEY`.
4. Enable email magic-link auth under Authentication → Providers (enabled by
   default; no password provider is used).
5. Create a Vercel project (`vercel link`), set the same environment
   variables plus `YOUTUBE_API_KEY`, `APIFY_API_TOKEN`, `ANTHROPIC_API_KEY`,
   and `RATE_LIMIT_IP_SALT` in the Vercel dashboard, then `vercel deploy`.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/env.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add .env.example README.md tests/unit/env.test.ts
git commit -m "docs: add .env.example and dev-setup / real-Supabase-connection instructions"
```

---

## Self-Review Notes

**Spec coverage:** All six scope items are covered — scaffold/tooling (Tasks 1–2), full schema for all six tables (Tasks 3–8), Supabase client helpers (Task 9), glossary system (Tasks 10–11), rate limiting (Tasks 12–13), the three integration modules (Tasks 14–16), diagnostic scoring in five dimension-tasks + combine (Tasks 17–21), report generation glue (Task 22), API route + rate-limit enforcement (Task 23), three pages (Tasks 24–26), E2E smoke test (Task 27), and env/README wiring (Task 28).

**Placeholder scan:** No task contains TBD/TODO or "similar to Task N" — every step has complete, runnable code. Tasks 1–2 deliberately deviate from the strict RED/GREEN cycle (documented inline) because no test runner exists until Task 2 completes.

**Type consistency verified across tasks:** `ScoreResult`/`ScoreLabel`/`labelForScore` (17) → consumed identically in 18–21; `CombinedScore` (21) → consumed in `report.ts` (22); `DiagnosticReport` (22) → consumed in `handler.ts` and `route.ts` (23); `RateLimitStore` (12) → implemented identically by the in-memory fake (12) and the Supabase adapter (13), both consumed by `handler.ts` (23); `GlossaryTerm`/`GlossarySegment`/`linkGlossaryTerms` (10) → consumed by `GlossaryChip`/`GlossaryText` (11) and `report.ts` (22); `Database` type (9) → consumed by `rate-limit-store.ts` (13) and both API routes (23, 26).

---

## Execution Handoff

Once approved, save this plan to `docs/superpowers/plans/2026-08-12-creator-dashboard-scaffold.md` and choose an execution path:

1. **Subagent-Driven (recommended)** — `superpowers:subagent-driven-development`: a fresh implementer subagent per task, isolated in a git worktree, with a task-level review after each task and one final whole-branch review at the end.
2. **Inline Execution** — `superpowers:executing-plans`: batch execution in this session with review checkpoints between tasks.

## Verification (end-to-end, once all 28 tasks are complete)

1. `npm install && npm run typecheck && npm run lint` — clean typecheck and lint.
2. `npm test` — full Vitest suite green (migrations, Supabase client, glossary, rate-limit, all three integration modules, all five scoring dimensions + combiner, report glue, handler, all three pages, env/README checks).
3. `npm run build` — production build succeeds with placeholder `.env.local` values (no live Supabase/API credentials required).
4. `npx playwright install --with-deps chromium && npm run test:e2e` — the diagnostic-smoke E2E test passes against the local dev server with all network calls mocked.
5. Confirm no `mcp__Supabase__*` / `mcp__Vercel__*` tool calls appear anywhere in the task commits — grep the diff for `mcp__` as a final check that no live resources were touched.
6. Manually skim `supabase/migrations/*.sql` against the six-table schema in the File Structure section to confirm nothing was silently dropped.
