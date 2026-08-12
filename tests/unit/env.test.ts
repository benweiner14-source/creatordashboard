import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('.env.example', () => {
  it('documents every environment variable referenced by the app', () => {
    const envExample = readFileSync(join(process.cwd(), '.env.example'), 'utf-8');
    const documentedKeys = [...envExample.matchAll(/^([A-Z0-9_]+)=/gm)].map((m) => m[1]);

    const requiredKeys = [
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'YOUTUBE_API_KEY',
      'APIFY_API_TOKEN',
      'ANTHROPIC_API_KEY',
      'RATE_LIMIT_IP_SALT',
    ];

    for (const key of requiredKeys) {
      expect(documentedKeys).toContain(key);
    }
  });
});

describe('README', () => {
  it('documents local dev setup and how to connect a real Supabase project', () => {
    const readme = readFileSync(join(process.cwd(), 'README.md'), 'utf-8');
    expect(readme).toContain('npm install');
    expect(readme).toContain('npm test');
    expect(readme.toLowerCase()).toContain('connecting a real supabase project');
  });
});
