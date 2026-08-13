-- A creator connects by saving a public handle/profile URL per platform —
-- no OAuth token, since these are public data sources. See
-- docs/superpowers/specs/2026-08-13-recap-card-design.md §1.
alter table public.profiles
  add column youtube_channel_handle text,
  add column tiktok_handle text,
  add column instagram_handle text;

-- Stores computed stats only, never a binary image — the card itself is
-- rendered on demand by app/recap/[id]/image/route.tsx from this row's
-- JSON. One row per (profile, month): the unique constraint is what makes
-- generation idempotent and safe to be on-demand (spec §2, generation
-- pipeline step 2).
create table if not exists public.recap_cards (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  month date not null,
  platform_data jsonb not null,
  totals jsonb not null,
  top_post jsonb not null,
  warnings text[] not null default '{}',
  generated_at timestamptz not null default now(),
  unique (profile_id, month)
);

alter table public.recap_cards enable row level security;

create policy "Recap cards are viewable by owner"
  on public.recap_cards for select
  using (auth.uid() = profile_id);

create policy "Recap cards are insertable by owner"
  on public.recap_cards for insert
  with check (auth.uid() = profile_id);
