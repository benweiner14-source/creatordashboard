-- Perf follow-up (flagged by the Supabase advisor: auth_rls_initplan).
-- Every owner-scoped RLS policy called `auth.uid()` directly, which
-- Postgres re-evaluates once per row instead of once per query.
-- Wrapping the call as `(select auth.uid())` lets the planner treat it as
-- an initplan and evaluate it a single time. Behavior is unchanged — only
-- the query plan improves. See
-- https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select

alter policy "Profiles are viewable by owner"
  on public.profiles
  using ((select auth.uid()) = id);

alter policy "Profiles are updatable by owner"
  on public.profiles
  using ((select auth.uid()) = id);

alter policy "Diagnostics are viewable by owner"
  on public.diagnostics
  using ((select auth.uid()) = profile_id);

alter policy "Diagnostics are insertable by owner"
  on public.diagnostics
  with check ((select auth.uid()) = profile_id);

alter policy "Weekly digests are viewable by owner"
  on public.weekly_digests
  using ((select auth.uid()) = profile_id);

alter policy "Recap cards are viewable by owner"
  on public.recap_cards
  using ((select auth.uid()) = profile_id);

alter policy "Recap cards are insertable by owner"
  on public.recap_cards
  with check ((select auth.uid()) = profile_id);

alter policy "Platform connections are viewable by owner"
  on public.platform_connections
  using ((select auth.uid()) = profile_id);
