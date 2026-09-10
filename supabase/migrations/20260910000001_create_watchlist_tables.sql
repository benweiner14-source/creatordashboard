create table public.watchlist_entries (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  platform public.diagnostic_platform not null,
  handle text not null,
  url text not null,
  label text,
  last_error text,
  created_at timestamptz not null default now(),
  unique (profile_id, platform, handle)
);

alter table public.watchlist_entries enable row level security;

create policy "Watchlist entries are viewable by owner"
  on public.watchlist_entries for select
  using ((select auth.uid()) = profile_id);

create policy "Watchlist entries are insertable by owner"
  on public.watchlist_entries for insert
  with check ((select auth.uid()) = profile_id);

create policy "Watchlist entries are deletable by owner"
  on public.watchlist_entries for delete
  using ((select auth.uid()) = profile_id);

create table public.watchlist_snapshots (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.watchlist_entries(id) on delete cascade,
  captured_at timestamptz not null default now(),
  subscriber_count integer,
  total_view_count bigint not null,
  video_count integer not null,
  top_posts jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.watchlist_snapshots enable row level security;

create policy "Watchlist snapshots are viewable by owner"
  on public.watchlist_snapshots for select
  using (
    exists (
      select 1 from public.watchlist_entries
      where watchlist_entries.id = watchlist_snapshots.entry_id
        and watchlist_entries.profile_id = (select auth.uid())
    )
  );

create index watchlist_snapshots_entry_id_captured_at_idx
  on public.watchlist_snapshots (entry_id, captured_at desc);
