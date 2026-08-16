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
});
