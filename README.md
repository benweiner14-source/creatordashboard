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
   **Also required:** add `<your-app-origin>/auth/callback` (e.g.
   `https://your-app.vercel.app/auth/callback` and, for local dev,
   `http://localhost:3000/auth/callback`) to the project's **Redirect URLs**
   allow list under Authentication → URL Configuration. If it's missing,
   Supabase silently ignores the `emailRedirectTo` passed with each magic
   link and falls back to the Site URL instead — the sign-in round trip
   (including the preserved diagnostic URL) will silently fail in
   production even though every automated test still passes, since the
   tests all mock the Supabase client and never exercise the real
   allow-list check.
5. Create a Vercel project (`vercel link`), set the same environment
   variables plus `YOUTUBE_API_KEY`, `APIFY_API_TOKEN`, `ANTHROPIC_API_KEY`,
   and `RATE_LIMIT_IP_SALT` in the Vercel dashboard, then `vercel deploy`.

**Self-hosting instead of Vercel?** The per-IP rate-limit cap trusts the
`x-forwarded-for` header to identify a client's IP — on Vercel this is safe
automatically (its edge network sets that header itself, so a client
can't forge it). Anywhere else, set `TRUSTED_PROXY_HOPS` in your
environment to the number of reverse-proxy hops in front of the app that
you trust (see `.env.example`), or the app will deliberately not trust
the header at all and every request will share one "unknown IP" bucket —
safe, but it means the per-IP cap won't do anything until configured.
