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
