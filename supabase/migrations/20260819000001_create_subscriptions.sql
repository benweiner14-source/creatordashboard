create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  stripe_customer_id text not null unique,
  stripe_subscription_id text unique,
  status text not null check (status in ('active', 'past_due', 'canceled', 'incomplete')),
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.subscriptions enable row level security;

create policy "Subscriptions are viewable by owner"
  on public.subscriptions for select
  using ((select auth.uid()) = profile_id);

-- No client-facing insert/update/delete policies: only the service-role
-- checkout route (insert) and webhook route (update) ever write here.
