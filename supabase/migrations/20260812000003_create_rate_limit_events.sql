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
