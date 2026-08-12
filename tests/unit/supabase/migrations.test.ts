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
});
