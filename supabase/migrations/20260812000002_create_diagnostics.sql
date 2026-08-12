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
