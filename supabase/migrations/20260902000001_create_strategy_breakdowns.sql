create table public.strategy_breakdowns (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  platform public.diagnostic_platform not null,
  channel_handle text not null,
  channel_url text not null,
  post_count integer not null,
  cadence jsonb not null,
  format_mix jsonb not null,
  top_posts jsonb not null,
  headline text not null,
  explanation text not null,
  created_at timestamptz not null default now()
);

alter table public.strategy_breakdowns enable row level security;

create policy "Strategy breakdowns are viewable by owner"
  on public.strategy_breakdowns for select
  using ((select auth.uid()) = profile_id);

create policy "Strategy breakdowns are insertable by owner"
  on public.strategy_breakdowns for insert
  with check ((select auth.uid()) = profile_id);
