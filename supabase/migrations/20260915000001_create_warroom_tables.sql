create table public.warroom_alerts (
  id uuid primary key default gen_random_uuid(),
  platform public.diagnostic_platform not null,
  external_post_id text not null,
  url text not null,
  caption_or_title text not null,
  view_count integer not null,
  engagement_count integer not null,
  published_at timestamptz not null,
  severity text not null check (severity in ('heating_up', 'going_viral', 'already_viral')),
  detected_at timestamptz not null default now(),
  unique (platform, external_post_id)
);

alter table public.warroom_alerts enable row level security;
-- No select policy for regular users: GET /api/warroom (the feed route)
-- is the only reader and always uses the service-role client, gating on
-- subscription status in the handler (lib/warroom/handler.ts) — unlike
-- every other paid-content table in this codebase (which gate by owning
-- profile_id), this is a shared feed with no profile_id to gate by, so
-- RLS enabled with zero policies is the correct default-deny here, same
-- pattern as warroom_settings below.

create index warroom_alerts_detected_at_idx
  on public.warroom_alerts (detected_at desc);

create table public.warroom_settings (
  id boolean primary key default true check (id),
  paused boolean not null default false,
  paused_reason text,
  paused_at timestamptz
);

insert into public.warroom_settings (id) values (true) on conflict (id) do nothing;

alter table public.warroom_settings enable row level security;
-- No select/insert/update policy for regular users: this table is
-- operational state, read and written only by the service-role client
-- (the cron route). RLS enabled with zero policies denies every
-- non-service-role query by default.

alter table public.profiles
  add column warroom_email_opt_in boolean not null default false;
