-- supabase/migrations/20260814000002_create_platform_connections.sql
-- OAuth connections for TikTok/Instagram, replacing the Apify/handle
-- bridge on a per-platform basis once a creator connects. See
-- docs/superpowers/specs/2026-08-14-oauth-fast-follow-design.md §1.
-- profiles.tiktok_handle/instagram_handle (added for Recap Card) are
-- untouched by this migration — they remain the fallback path's input for
-- an unconnected platform.
create table if not exists public.platform_connections (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  platform text not null check (platform in ('tiktok', 'instagram')),
  provider_user_id text not null,
  access_token_encrypted text not null,
  refresh_token_encrypted text,
  expires_at timestamptz,
  scopes text[] not null default '{}',
  connected_at timestamptz not null default now(),
  unique (profile_id, platform)
);

alter table public.platform_connections enable row level security;

-- Owner-select is defense-in-depth, not the real access path: application
-- code always reads/writes this table server-side via the service-role
-- client (same pattern as recap_cards/weekly_digests), and even under this
-- policy what the client could see is ciphertext, never a usable token.
create policy "Platform connections are viewable by owner"
  on public.platform_connections for select
  using (auth.uid() = profile_id);
