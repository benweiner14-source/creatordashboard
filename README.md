# creatordashboard

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
