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
});
