create table if not exists public.niche_community_sources (
  id uuid primary key default gen_random_uuid(),
  niche text not null,
  source_type text not null,
  source_identifier text not null,
  last_scraped_at timestamptz,
  created_at timestamptz not null default now(),
  unique (niche, source_type, source_identifier)
);

alter table public.niche_community_sources enable row level security;

-- Read by server-side digest generation only (service role); no
-- client-facing policies are granted for this table.
