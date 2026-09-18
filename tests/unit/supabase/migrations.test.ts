import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

function readMigrationContaining(needle: string): string {
  const files = readdirSync(MIGRATIONS_DIR);
  const file = files.find((f) => f.includes(needle));
  if (!file) throw new Error(`No migration file matching "${needle}"`);
  return readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
}

describe('supabase migrations', () => {
  it('includes a profiles table migration with RLS enabled', () => {
    const sql = readMigrationContaining('create_profiles');
    expect(sql).toContain('create table if not exists public.profiles');
    expect(sql).toContain('references auth.users(id)');
    expect(sql).toContain('alter table public.profiles enable row level security');
  });

  it('includes a diagnostics table migration with the expected enums and columns', () => {
    const sql = readMigrationContaining('create_diagnostics');
    expect(sql).toContain("create type public.diagnostic_platform as enum ('youtube', 'tiktok', 'instagram')");
    expect(sql).toContain("create type public.diagnostic_status as enum ('pending', 'complete', 'failed')");
    expect(sql).toContain('create table if not exists public.diagnostics');
    expect(sql).toContain('report_json jsonb');
    expect(sql).toContain('references public.profiles(id)');
  });

  it('includes a rate_limit_events table migration indexed for lookups by profile and IP hash', () => {
    const sql = readMigrationContaining('create_rate_limit_events');
    expect(sql).toContain('create table if not exists public.rate_limit_events');
    expect(sql).toContain('ip_hash text not null');
    expect(sql).toContain('rate_limit_events_profile_id_created_at_idx');
    expect(sql).toContain('rate_limit_events_ip_hash_created_at_idx');
  });

  it('includes a glossary_terms table migration seeded with 6 terms, readable by everyone', () => {
    const sql = readMigrationContaining('create_glossary_terms');
    expect(sql).toContain('create table if not exists public.glossary_terms');
    expect(sql).toContain('slug text not null unique');
    expect(sql).toContain('"Glossary terms are viewable by everyone"');
    const insertMatches = sql.match(/\('[a-z-]+', '(?:[^']|'')*', '(?:[^']|'')*', '(?:[^']|'')*'\)/g) ?? [];
    expect(insertMatches.length).toBe(6);
    expect(sql).toContain("'hook-rate'");
  });

  it('includes a weekly_digests table migration unique per profile per week', () => {
    const sql = readMigrationContaining('create_weekly_digests');
    expect(sql).toContain('create table if not exists public.weekly_digests');
    expect(sql).toContain('week_start date not null');
    expect(sql).toContain('unique (profile_id, week_start)');
  });

  it('includes a niche_community_sources table migration unique per niche/source', () => {
    const sql = readMigrationContaining('create_niche_community_sources');
    expect(sql).toContain('create table if not exists public.niche_community_sources');
    expect(sql).toContain('source_type text not null');
    expect(sql).toContain('unique (niche, source_type, source_identifier)');
  });

  it('includes an atomic check-and-record rate limit function using advisory locks', () => {
    const sql = readMigrationContaining('add_atomic_rate_limit_function');
    expect(sql).toContain('create or replace function public.check_and_record_rate_limit');
    expect(sql).toContain('pg_advisory_xact_lock');
    expect(sql).toContain('insert into public.rate_limit_events');
    expect(sql).toContain('create or replace function public.release_rate_limit_event');
    expect(sql).toContain('delete from public.rate_limit_events where id = p_event_id');
  });

  it('includes a migration generalizing rate_limit_events to a non-profile identity_hash', () => {
    const sql = readMigrationContaining('add_rate_limit_identity_hash');
    expect(sql).toContain('add column if not exists identity_hash text');
    expect(sql).toContain('create or replace function public.check_and_record_rate_limit');
    expect(sql).toContain('p_identity_hash text');
    expect(sql).toContain("raise exception 'check_and_record_rate_limit requires either p_profile_id or p_identity_hash'");
    expect(sql).toContain("raise exception 'check_and_record_rate_limit accepts only one of p_profile_id or p_identity_hash'");
    expect(sql).toContain('where identity_hash = p_identity_hash');
    expect(sql).toContain('rate_limit_events_identity_hash_created_at_idx');
  });

  it('includes a migration adding recap platform handles to profiles and a recap_cards table', () => {
    const sql = readMigrationContaining('create_recap_cards');
    expect(sql).toContain('add column youtube_channel_handle text');
    expect(sql).toContain('add column tiktok_handle text');
    expect(sql).toContain('add column instagram_handle text');
    expect(sql).toContain('create table if not exists public.recap_cards');
    expect(sql).toContain('unique (profile_id, month)');
    expect(sql).toContain('"Recap cards are viewable by owner"');
    expect(sql).toContain('"Recap cards are insertable by owner"');
  });

  it('includes a platform_connections table migration with encrypted token columns', () => {
    const sql = readMigrationContaining('create_platform_connections');
    expect(sql).toContain('create table if not exists public.platform_connections');
    expect(sql).toContain("platform text not null check (platform in ('tiktok', 'instagram'))");
    expect(sql).toContain('access_token_encrypted text not null');
    expect(sql).toContain('refresh_token_encrypted text');
    expect(sql).toContain('unique (profile_id, platform)');
    expect(sql).toContain('"Platform connections are viewable by owner"');
  });

  it('includes a migration wrapping RLS auth.uid() calls in a select subquery for perf', () => {
    const sql = readMigrationContaining('optimize_rls_auth_uid_calls');
    expect(sql).toContain('alter policy "Profiles are viewable by owner"');
    expect(sql).toContain('alter policy "Profiles are updatable by owner"');
    expect(sql).toContain('alter policy "Diagnostics are viewable by owner"');
    expect(sql).toContain('alter policy "Diagnostics are insertable by owner"');
    expect(sql).toContain('alter policy "Weekly digests are viewable by owner"');
    expect(sql).toContain('alter policy "Recap cards are viewable by owner"');
    expect(sql).toContain('alter policy "Recap cards are insertable by owner"');
    expect(sql).toContain('alter policy "Platform connections are viewable by owner"');
    const wrappedCalls = sql.match(/using \(\(select auth\.uid\(\)\)|with check \(\(select auth\.uid\(\)\)/g) ?? [];
    expect(wrappedCalls.length).toBe(8);
  });

  it('includes a migration adding weekly digest opt-in and last-sent tracking to profiles', () => {
    const sql = readMigrationContaining('add_weekly_digest_email_fields');
    expect(sql).toContain('add column digest_email_opt_in boolean not null default false');
    expect(sql).toContain('add column digest_last_sent_at timestamptz');
  });

  it('includes a subscriptions table migration unique per profile and per Stripe customer', () => {
    const sql = readMigrationContaining('create_subscriptions');
    expect(sql).toContain('create table public.subscriptions');
    expect(sql).toContain('profile_id uuid not null unique references public.profiles(id)');
    expect(sql).toContain('stripe_customer_id text not null unique');
    expect(sql).toContain("status text not null check (status in ('active', 'past_due', 'canceled', 'incomplete'))");
    expect(sql).toContain('"Subscriptions are viewable by owner"');
  });

  it('includes a strategy_breakdowns table migration owned by profile', () => {
    const sql = readMigrationContaining('create_strategy_breakdowns');
    expect(sql).toContain('create table public.strategy_breakdowns');
    expect(sql).toContain('platform public.diagnostic_platform not null');
    expect(sql).toContain('references public.profiles(id)');
    expect(sql).toContain('top_posts jsonb not null');
    expect(sql).toContain('"Strategy breakdowns are viewable by owner"');
    expect(sql).toContain('"Strategy breakdowns are insertable by owner"');
  });

  it('includes a linkedin_strategies table migration owned by profile', () => {
    const sql = readMigrationContaining('create_linkedin_tables');
    expect(sql).toContain('create table public.linkedin_strategies');
    expect(sql).toContain('content_pillars jsonb not null');
    expect(sql).toContain('references public.profiles(id)');
    expect(sql).toContain('"LinkedIn strategies are viewable by owner"');
    expect(sql).toContain('"LinkedIn strategies are insertable by owner"');
  });

  it('includes a linkedin_post_ideas table migration unique per profile per week, referencing a strategy', () => {
    const sql = readMigrationContaining('create_linkedin_tables');
    expect(sql).toContain('create table public.linkedin_post_ideas');
    expect(sql).toContain('strategy_id uuid not null references public.linkedin_strategies(id)');
    expect(sql).toContain('unique (profile_id, week_start)');
  });

  it('includes a linkedin_profile_audits table migration with no PDF-storing column', () => {
    const sql = readMigrationContaining('create_linkedin_tables');
    expect(sql).toContain('create table public.linkedin_profile_audits');
    expect(sql).toContain('working_well jsonb not null');
    expect(sql).toContain('needs_work jsonb not null');
    expect(sql).not.toMatch(/(^|[^a-z0-9])(pdf|file)([^a-z0-9]|$)/i);
  });

  it('includes a watchlist_entries table migration unique per profile/platform/handle', () => {
    const sql = readMigrationContaining('create_watchlist_tables');
    expect(sql).toContain('create table public.watchlist_entries');
    expect(sql).toContain('platform public.diagnostic_platform not null');
    expect(sql).toContain('unique (profile_id, platform, handle)');
    expect(sql).toContain('"Watchlist entries are viewable by owner"');
    expect(sql).toContain('"Watchlist entries are insertable by owner"');
    expect(sql).toContain('"Watchlist entries are deletable by owner"');
  });

  it('includes a watchlist_snapshots table migration owned indirectly through its entry', () => {
    const sql = readMigrationContaining('create_watchlist_tables');
    expect(sql).toContain('create table public.watchlist_snapshots');
    expect(sql).toContain('references public.watchlist_entries(id) on delete cascade');
    expect(sql).toContain('top_posts jsonb not null');
    expect(sql).toContain('"Watchlist snapshots are viewable by owner"');
    expect(sql).toContain('watchlist_snapshots_entry_id_captured_at_idx');
  });

  it('includes a warroom_alerts table migration deduplicated by platform and external post id, with no user-facing RLS policy', () => {
    const sql = readMigrationContaining('create_warroom_tables');
    expect(sql).toContain('create table public.warroom_alerts');
    expect(sql).toContain("severity text not null check (severity in ('heating_up', 'going_viral', 'already_viral'))");
    expect(sql).toContain('unique (platform, external_post_id)');
    expect(sql).toContain('alter table public.warroom_alerts enable row level security');
    // The feed route reads this table exclusively through the service-role
    // client and gates on subscription status in the handler, so any
    // anon/authenticated select policy here would be a paywall bypass.
    expect(sql).not.toMatch(/create policy[\s\S]*?on public\.warroom_alerts/);
    expect(sql).toContain('warroom_alerts_detected_at_idx');
  });

  it('includes a warroom_settings singleton table migration with no user-facing RLS policy', () => {
    const sql = readMigrationContaining('create_warroom_tables');
    expect(sql).toContain('create table public.warroom_settings');
    expect(sql).toContain('id boolean primary key default true check (id)');
    expect(sql).toContain('alter table public.warroom_settings enable row level security');
    // Checked as "no policy mentions warroom_settings" rather than a bare
    // `not.toContain('create policy')` so this stays precise if a policy on
    // some other table is ever added to this migration.
    expect(sql).not.toMatch(/create policy[\s\S]*?on public\.warroom_settings/);
  });

  it('adds a warroom_email_opt_in column to profiles', () => {
    const sql = readMigrationContaining('create_warroom_tables');
    expect(sql).toContain('alter table public.profiles');
    expect(sql).toContain('add column warroom_email_opt_in boolean not null default false');
  });

  it('includes a migration adding reach_score to diagnostics', () => {
    const sql = readMigrationContaining('add_reach_score');
    expect(sql).toContain('alter table public.diagnostics');
    expect(sql).toContain('add column reach_score integer');
  });

  it('includes a migration adding visual/audio columns to diagnostics', () => {
    const sql = readMigrationContaining('add_visual_audio_columns');
    expect(sql).toContain('alter table public.diagnostics');
    expect(sql).toContain("visual_audio_status text check (visual_audio_status in ('pending', 'complete', 'failed'))");
    expect(sql).toContain('visual_audio_narrative text');
    expect(sql).toContain('visual_audio_error text');
  });

  it('includes a migration adding episodic-detection columns to diagnostics', () => {
    const sql = readMigrationContaining('add_episodic_detection');
    expect(sql).toContain('alter table public.diagnostics');
    expect(sql).toContain('visual_audio_is_episodic boolean');
    expect(sql).toContain('visual_audio_series_label text');
  });
});
