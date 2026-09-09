create table public.linkedin_strategies (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  niche text not null,
  target_goal text not null,
  content_pillars jsonb not null,
  posting_cadence_recommendation text not null,
  positioning_notes text not null,
  headline text not null,
  created_at timestamptz not null default now()
);

alter table public.linkedin_strategies enable row level security;

create policy "LinkedIn strategies are viewable by owner"
  on public.linkedin_strategies for select
  using ((select auth.uid()) = profile_id);

create policy "LinkedIn strategies are insertable by owner"
  on public.linkedin_strategies for insert
  with check ((select auth.uid()) = profile_id);


create table public.linkedin_post_ideas (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  strategy_id uuid not null references public.linkedin_strategies(id) on delete cascade,
  week_start date not null,
  post_ideas jsonb not null,
  created_at timestamptz not null default now(),
  unique (profile_id, week_start)
);

alter table public.linkedin_post_ideas enable row level security;

create policy "LinkedIn post ideas are viewable by owner"
  on public.linkedin_post_ideas for select
  using ((select auth.uid()) = profile_id);

create policy "LinkedIn post ideas are insertable by owner"
  on public.linkedin_post_ideas for insert
  with check ((select auth.uid()) = profile_id);


create table public.linkedin_profile_audits (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  headline text not null,
  working_well jsonb not null,
  needs_work jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.linkedin_profile_audits enable row level security;

create policy "LinkedIn profile audits are viewable by owner"
  on public.linkedin_profile_audits for select
  using ((select auth.uid()) = profile_id);

create policy "LinkedIn profile audits are insertable by owner"
  on public.linkedin_profile_audits for insert
  with check ((select auth.uid()) = profile_id);
