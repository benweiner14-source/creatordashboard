# OAuth Fast-Follow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add official OAuth connections to TikTok and Instagram for Recap Card, replacing the Apify/handle scraping bridge on a per-platform basis — a creator who connects a platform gets that platform's data via the official API going forward; an unconnected platform keeps working exactly as it does on `main` today.

**Architecture:** A new `lib/oauth/` module (state-nonce generation, the callback handler, and refresh-aware connection reads) plus two new hand-rolled provider clients (`lib/integrations/tiktok-oauth.ts`, `lib/integrations/instagram-oauth.ts`) that both implement one shared `OAuthProviderClient` interface and return the exact `ProfilePost[]` shape the existing Apify path already produces. `lib/recap/handler.ts` gets one new dependency and picks per platform, per creator, between the OAuth path and the existing Apify/handle path — `lib/recap/aggregate.ts` needs zero changes. Tokens are encrypted at rest via a new `lib/crypto.ts` module before ever reaching Postgres.

**Tech Stack:** Next.js 16 (App Router) + TypeScript, Node's built-in `crypto` (AES-256-GCM, no new dependency), the same hand-rolled `fetch`-based integration-client pattern already used by `lib/integrations/youtube.ts`/`scraper.ts`/`claude.ts` (no OAuth SDK), Supabase (existing), Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-14-oauth-fast-follow-design.md` (committed at `3c26826`) — this plan implements every section of that spec.

## Global Constraints

- Platform scope: TikTok + Instagram OAuth only, for Recap Card. No YouTube OAuth, no Diagnostic changes, no Weekly Content Ideas changes in this plan.
- Per-platform replacement, not a forced migration: a connected platform uses the official API; an unconnected platform keeps using the existing saved-handle + Apify path. Both coexist permanently.
- Architecture is Approach A: new provider clients return `ProfilePost[]` (the exact type already exported from `lib/integrations/scraper.ts`); the connected-vs-not branching decision lives in `lib/recap/handler.ts`, never inside `lib/integrations/scraper.ts`.
- Tokens are encrypted at rest (AES-256-GCM via `lib/crypto.ts`, keyed by a new `OAUTH_TOKEN_ENCRYPTION_KEY` env var) before every write; decrypted only at read time, server-side, via the service-role client — never sent to the browser.
- Token refresh is lazy, at use time only, inside `lib/oauth/connections.ts`'s `getPlatformConnection` — no cron, no scheduled job (none exists anywhere in this codebase and this plan doesn't introduce one).
- No new rate-limit event type for connect/disconnect — connecting requires a real human clicking through a real provider consent screen each time (self-limiting); disconnect is a trivial delete.
- OAuth-fetched post count is capped the same way Apify's `PROFILE_SCRAPE_RESULTS_LIMIT` already bounds cost (50 results).
- The OAuth redirect URI is built from the incoming request's own origin at runtime — no new env var for it, matching `app/api/auth/magic-link/route.ts`'s existing convention.
- Connect/disconnect UI lives on the existing `/recap` page — no new settings/connections page.
- Exact platform scope strings and endpoint URLs for TikTok's and Instagram's OAuth/Display/Graph APIs are confirmed against each platform's live current developer documentation at implementation time, not assumed from training-data memory — the same discipline this codebase already applied to YouTube's `forHandle` parameter and to `ImageResponse`'s API surface. Each task below flags exactly which values need that check before shipping.
- Built and fully testable now against each platform's development/sandbox-tier scopes (limited to registered test users); full platform app-review approval is a parallel, external process, not a blocker for any task in this plan — nothing in this plan's code differs between sandbox and production, only the client id/secret values an operator sets in the deployment environment once review clears.

---

## File Structure

```
supabase/migrations/
  20260814000002_create_platform_connections.sql   # new table

lib/
  crypto.ts                          # encryptToken, decryptToken (AES-256-GCM)
  oauth/
    types.ts                         # OAuthPlatform, OAuthTokenSet, OAuthProviderClient (shared interface)
    state.ts                         # generateOAuthState, oauthStateCookieName
    handler.ts                       # handleOAuthCallback
    connections.ts                   # getPlatformConnection (refresh-aware read), disconnectPlatform
  integrations/
    tiktok-oauth.ts                  # createTikTokOAuthClient — implements OAuthProviderClient
    instagram-oauth.ts               # createInstagramOAuthClient — implements OAuthProviderClient
  recap/
    handler.ts                       # MODIFIED — getPlatformConnection + oauthClients deps, per-platform branching
    page-state.ts                    # MODIFIED — RecapConnectionStatus, DISCONNECTED event, gating rule
  supabase/
    types.ts                         # MODIFIED — platform_connections table type

app/api/oauth/[platform]/
  authorize/route.ts                 # GET — redirects to the provider's consent screen
  callback/route.ts                  # GET — exchanges code, saves the connection, redirects to /recap
  disconnect/route.ts                # POST — deletes the connection row

app/api/recap/
  route.ts                           # MODIFIED — GET returns connections; POST wires getPlatformConnection

app/recap/
  page.tsx                           # MODIFIED — connect/disconnect UI per platform, toast on return

.env.example                         # MODIFIED — new OAuth env vars

tests/fakes/
  oauth-provider.fake.ts             # createFakeOAuthProviderClient

tests/unit/
  lib/crypto.test.ts
  lib/oauth/state.test.ts
  lib/oauth/handler.test.ts
  lib/oauth/connections.test.ts
  lib/integrations/tiktok-oauth.test.ts
  lib/integrations/instagram-oauth.test.ts
  lib/recap/handler.test.ts          # MODIFIED
  lib/recap/page-state.test.ts       # MODIFIED
  app/api/oauth/route.test.ts        # authorize/callback/disconnect routes
  supabase/migrations.test.ts        # MODIFIED — new test case for platform_connections migration

tests/e2e/
  oauth-connect-smoke.spec.ts
```

---

### Task 1: SQL migration — `platform_connections` table + `Database` types

**Files:**
- Create: `supabase/migrations/20260814000002_create_platform_connections.sql`
- Modify: `lib/supabase/types.ts`
- Modify: `tests/unit/supabase/migrations.test.ts`

**Interfaces:**
- Consumes: `public.profiles` (existing)
- Produces: `public.platform_connections` table (`profile_id`, `platform`, `provider_user_id`, `access_token_encrypted`, `refresh_token_encrypted`, `expires_at`, `scopes`, `connected_at`, unique `(profile_id, platform)`); `Database['public']['Tables']['platform_connections']` type — relied on by every later task that touches Supabase for this table

- [ ] **Step 1: Write the failing test**

Append to the existing `describe('supabase migrations', ...)` block in `tests/unit/supabase/migrations.test.ts`:

```ts
  it('includes a platform_connections table migration with encrypted token columns', () => {
    const sql = readMigrationContaining('create_platform_connections');
    expect(sql).toContain('create table if not exists public.platform_connections');
    expect(sql).toContain("platform text not null check (platform in ('tiktok', 'instagram'))");
    expect(sql).toContain('access_token_encrypted text not null');
    expect(sql).toContain('refresh_token_encrypted text');
    expect(sql).toContain('unique (profile_id, platform)');
    expect(sql).toContain('"Platform connections are viewable by owner"');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/supabase/migrations.test.ts`
Expected: FAIL with "No migration file matching \"create_platform_connections\""

- [ ] **Step 3: Write the migration**

```sql
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
```

- [ ] **Step 4: Update `lib/supabase/types.ts`**

Add a new `platform_connections` entry to the `Tables` object, immediately after the existing `recap_cards` entry:

```ts
      platform_connections: {
        Row: {
          id: string;
          profile_id: string;
          platform: 'tiktok' | 'instagram';
          provider_user_id: string;
          access_token_encrypted: string;
          refresh_token_encrypted: string | null;
          expires_at: string | null;
          scopes: string[];
          connected_at: string;
        };
        Insert: {
          id?: string;
          profile_id: string;
          platform: 'tiktok' | 'instagram';
          provider_user_id: string;
          access_token_encrypted: string;
          refresh_token_encrypted?: string | null;
          expires_at?: string | null;
          scopes?: string[];
          connected_at?: string;
        };
        Update: Partial<Database['public']['Tables']['platform_connections']['Insert']>;
        Relationships: [];
      };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/supabase/migrations.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260814000002_create_platform_connections.sql lib/supabase/types.ts tests/unit/supabase/migrations.test.ts
git commit -m "feat: add platform_connections table migration and Database types"
```

---

### Task 2: `lib/crypto.ts` — token encryption at rest

**Files:**
- Create: `lib/crypto.ts`
- Test: `tests/unit/lib/crypto.test.ts`

**Interfaces:**
- Consumes: nothing (Node's built-in `crypto` only)
- Produces: `encryptToken(plaintext, hexKey)`, `decryptToken(encoded, hexKey)` — relied on by Task 8's routes and Task 7's `lib/oauth/connections.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lib/crypto.test.ts
import { describe, it, expect } from 'vitest';
import { encryptToken, decryptToken } from '@/lib/crypto';

const TEST_KEY = '0'.repeat(64); // 32 bytes of zero, a validly-shaped hex key for tests

describe('encryptToken / decryptToken', () => {
  it('round-trips a plaintext value', () => {
    const ciphertext = encryptToken('my-secret-access-token', TEST_KEY);
    expect(decryptToken(ciphertext, TEST_KEY)).toBe('my-secret-access-token');
  });

  it('produces ciphertext that does not contain the plaintext', () => {
    const ciphertext = encryptToken('my-secret-access-token', TEST_KEY);
    expect(ciphertext).not.toContain('my-secret-access-token');
  });

  it('produces different ciphertext for the same plaintext on each call (random IV)', () => {
    const a = encryptToken('same-value', TEST_KEY);
    const b = encryptToken('same-value', TEST_KEY);
    expect(a).not.toBe(b);
  });

  it('throws when the key is not a 32-byte hex string', () => {
    expect(() => encryptToken('value', 'too-short')).toThrow('32-byte');
  });

  it('throws when decrypting with the wrong key', () => {
    const ciphertext = encryptToken('value', TEST_KEY);
    const wrongKey = '1'.repeat(64);
    expect(() => decryptToken(ciphertext, wrongKey)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/crypto.test.ts`
Expected: FAIL with `Cannot find module '@/lib/crypto'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/crypto.ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;

function loadKey(hexKey: string): Buffer {
  const key = Buffer.from(hexKey, 'hex');
  if (key.length !== 32) {
    throw new Error('Encryption key must be a 32-byte (64 hex character) key.');
  }
  return key;
}

/**
 * Encrypts a plaintext token for storage. Packs iv + authTag + ciphertext
 * into one base64 string so a single text column can hold it. See
 * docs/superpowers/specs/2026-08-14-oauth-fast-follow-design.md §1.
 */
export function encryptToken(plaintext: string, hexKey: string): string {
  const key = loadKey(hexKey);
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

export function decryptToken(encoded: string, hexKey: string): string {
  const key = loadKey(hexKey);
  const packed = Buffer.from(encoded, 'base64');
  const iv = packed.subarray(0, IV_LENGTH_BYTES);
  const authTag = packed.subarray(IV_LENGTH_BYTES, IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);
  const ciphertext = packed.subarray(IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/crypto.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/crypto.ts tests/unit/lib/crypto.test.ts
git commit -m "feat: add AES-256-GCM token encryption for OAuth token storage"
```

---

### Task 3: `lib/oauth/types.ts` + `lib/integrations/tiktok-oauth.ts`

**Files:**
- Create: `lib/oauth/types.ts`
- Create: `lib/integrations/tiktok-oauth.ts`
- Create: `tests/fakes/oauth-provider.fake.ts`
- Test: `tests/unit/lib/integrations/tiktok-oauth.test.ts`

**Interfaces:**
- Consumes: `ProfilePost` from `@/lib/integrations/scraper` (existing)
- Produces: `OAuthPlatform`, `OAuthTokenSet`, `OAuthProviderClient` (shared interface, relied on by every later `lib/oauth/*` task and by Task 4's Instagram client); `createTikTokOAuthClient(clientId, clientSecret)`; `createFakeOAuthProviderClient(overrides?)` — relied on by Tasks 6, 7, 9's tests

**⚠️ Live-doc check before finalizing this task:** TikTok's Login Kit authorize/token endpoint URLs, the exact scope names (`user.info.basic`, `video.list`), and the Display API's `video.list` field names below are written from the platform's current documented shape as of this plan's writing — confirm each against https://developers.tiktok.com/doc/login-kit-web and https://developers.tiktok.com/doc/tiktok-api-scopes before shipping, per this plan's Global Constraints.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lib/integrations/tiktok-oauth.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createTikTokOAuthClient } from '@/lib/integrations/tiktok-oauth';

describe('createTikTokOAuthClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds an authorize URL with the client key, scope, redirect_uri, and state', () => {
    const client = createTikTokOAuthClient('test-client-id', 'test-client-secret');
    const url = new URL(client.buildAuthorizeUrl('nonce-123', 'https://app.example.com/api/oauth/tiktok/callback'));
    expect(url.hostname).toBe('www.tiktok.com');
    expect(url.searchParams.get('client_key')).toBe('test-client-id');
    expect(url.searchParams.get('state')).toBe('nonce-123');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.example.com/api/oauth/tiktok/callback');
    expect(url.searchParams.get('scope')).toContain('user.info.basic');
  });

  it('exchanges a code for a token set', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 86400 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createTikTokOAuthClient('test-client-id', 'test-client-secret');
    const before = Date.now();
    const tokenSet = await client.exchangeCode('auth-code', 'https://app.example.com/api/oauth/tiktok/callback');

    expect(tokenSet.accessToken).toBe('access-1');
    expect(tokenSet.refreshToken).toBe('refresh-1');
    expect(tokenSet.expiresAt).not.toBeNull();
    expect(tokenSet.expiresAt!.getTime()).toBeGreaterThan(before);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://open.tiktokapis.com/v2/oauth/token/');
    expect(String(options.body)).toContain('code=auth-code');
  });

  it('throws when the token exchange request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400 }));
    const client = createTikTokOAuthClient('test-client-id', 'test-client-secret');
    await expect(client.exchangeCode('bad-code', 'https://app.example.com/callback')).rejects.toThrow('status 400');
  });

  it('fetches the provider user id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { user: { open_id: 'user-open-id-1' } } }) })
    );
    const client = createTikTokOAuthClient('test-client-id', 'test-client-secret');
    const userId = await client.getProviderUserId('access-1');
    expect(userId).toBe('user-open-id-1');
  });

  it('throws when there is no refresh token to refresh with', async () => {
    const client = createTikTokOAuthClient('test-client-id', 'test-client-secret');
    await expect(client.refreshAccessToken({ accessToken: 'a', refreshToken: null, expiresAt: null })).rejects.toThrow(
      'No TikTok refresh token'
    );
  });

  it('refreshes an access token, returning the rotated refresh token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 86400 }),
      })
    );
    const client = createTikTokOAuthClient('test-client-id', 'test-client-secret');
    const refreshed = await client.refreshAccessToken({ accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: null });
    expect(refreshed.accessToken).toBe('access-2');
    expect(refreshed.refreshToken).toBe('refresh-2');
  });

  it('fetches and normalizes profile posts into the shared ProfilePost shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            videos: [
              {
                id: '7000000000000000001',
                video_description: 'Day 1 of posting every day',
                create_time: 1755100800,
                share_url: 'https://www.tiktok.com/@creator/video/7000000000000000001',
                view_count: 12000,
                like_count: 900,
                comment_count: 60,
              },
            ],
          },
        }),
      })
    );
    const client = createTikTokOAuthClient('test-client-id', 'test-client-secret');
    const posts = await client.fetchProfilePosts('access-1');
    expect(posts).toEqual([
      {
        platform: 'tiktok',
        id: '7000000000000000001',
        caption: 'Day 1 of posting every day',
        publishedAt: new Date(1755100800 * 1000).toISOString(),
        viewCount: 12000,
        likeCount: 900,
        commentCount: 60,
        permalink: 'https://www.tiktok.com/@creator/video/7000000000000000001',
      },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/integrations/tiktok-oauth.test.ts`
Expected: FAIL with `Cannot find module '@/lib/integrations/tiktok-oauth'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/oauth/types.ts
import type { ProfilePost } from '@/lib/integrations/scraper';

export type OAuthPlatform = 'tiktok' | 'instagram';

export interface OAuthTokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
}

/**
 * Shared shape both lib/integrations/tiktok-oauth.ts and
 * lib/integrations/instagram-oauth.ts implement, so lib/oauth/handler.ts,
 * lib/oauth/connections.ts, and lib/recap/handler.ts can all depend on one
 * interface regardless of platform. See
 * docs/superpowers/specs/2026-08-14-oauth-fast-follow-design.md §2 (Approach A).
 */
export interface OAuthProviderClient {
  buildAuthorizeUrl(state: string, redirectUri: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<OAuthTokenSet>;
  getProviderUserId(accessToken: string): Promise<string>;
  /**
   * TikTok presents a distinct refresh_token; Instagram's long-lived token
   * refreshes by presenting itself. Each client's refreshAccessToken
   * accepts the current token set and knows which value to use internally
   * — callers never need to know the difference. See spec §3.
   */
  refreshAccessToken(current: OAuthTokenSet): Promise<OAuthTokenSet>;
  fetchProfilePosts(accessToken: string): Promise<ProfilePost[]>;
}
```

```ts
// lib/integrations/tiktok-oauth.ts
import type { ProfilePost } from './scraper';
import type { OAuthProviderClient, OAuthTokenSet } from '@/lib/oauth/types';

const AUTHORIZE_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const USER_INFO_URL = 'https://open.tiktokapis.com/v2/user/info/';
const VIDEO_LIST_URL = 'https://open.tiktokapis.com/v2/video/list/';

// user.info.basic identifies the creator; video.list reads their own
// videos' stats — the two Display API scopes this feature needs. Verify
// current scope names against https://developers.tiktok.com/doc/tiktok-api-scopes
// before shipping. See this plan's Global Constraints.
const SCOPES = 'user.info.basic,video.list';

// Mirrors PROFILE_SCRAPE_RESULTS_LIMIT in lib/integrations/scraper.ts —
// see spec §4.
const PROFILE_POSTS_MAX_RESULTS = 50;

function parseExpiresAt(expiresInSeconds: number | undefined): Date | null {
  if (!expiresInSeconds) return null;
  return new Date(Date.now() + expiresInSeconds * 1000);
}

export function createTikTokOAuthClient(clientId: string, clientSecret: string): OAuthProviderClient {
  return {
    buildAuthorizeUrl(state: string, redirectUri: string): string {
      const url = new URL(AUTHORIZE_URL);
      url.searchParams.set('client_key', clientId);
      url.searchParams.set('scope', SCOPES);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('state', state);
      return url.toString();
    },

    async exchangeCode(code: string, redirectUri: string): Promise<OAuthTokenSet> {
      const response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_key: clientId,
          client_secret: clientSecret,
          code,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
        }),
      });
      if (!response.ok) {
        throw new Error(`TikTok token exchange failed with status ${response.status}`);
      }
      const data = await response.json();
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? null,
        expiresAt: parseExpiresAt(data.expires_in),
      };
    },

    async getProviderUserId(accessToken: string): Promise<string> {
      const url = new URL(USER_INFO_URL);
      url.searchParams.set('fields', 'open_id');
      const response = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!response.ok) {
        throw new Error(`TikTok user info request failed with status ${response.status}`);
      }
      const data = await response.json();
      const openId = data.data?.user?.open_id;
      if (!openId) {
        throw new Error('TikTok user info response did not include open_id');
      }
      return openId;
    },

    async refreshAccessToken(current: OAuthTokenSet): Promise<OAuthTokenSet> {
      if (!current.refreshToken) {
        throw new Error('No TikTok refresh token available to refresh with');
      }
      const response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_key: clientId,
          client_secret: clientSecret,
          grant_type: 'refresh_token',
          refresh_token: current.refreshToken,
        }),
      });
      if (!response.ok) {
        throw new Error(`TikTok token refresh failed with status ${response.status}`);
      }
      const data = await response.json();
      return {
        accessToken: data.access_token,
        // TikTok rotates the refresh token on every use — the new one
        // must replace the old one, never re-store the presented value.
        refreshToken: data.refresh_token ?? null,
        expiresAt: parseExpiresAt(data.expires_in),
      };
    },

    async fetchProfilePosts(accessToken: string): Promise<ProfilePost[]> {
      const url = new URL(VIDEO_LIST_URL);
      url.searchParams.set(
        'fields',
        'id,video_description,create_time,share_url,view_count,like_count,comment_count'
      );
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ max_count: PROFILE_POSTS_MAX_RESULTS }),
      });
      if (!response.ok) {
        throw new Error(`TikTok video list request failed with status ${response.status}`);
      }
      const data = await response.json();
      const videos: Array<Record<string, unknown>> = data.data?.videos ?? [];
      return videos.map((v) => ({
        platform: 'tiktok' as const,
        id: String(v.id),
        caption: String(v.video_description ?? ''),
        publishedAt: new Date(Number(v.create_time) * 1000).toISOString(),
        viewCount: Number(v.view_count ?? 0),
        likeCount: Number(v.like_count ?? 0),
        commentCount: Number(v.comment_count ?? 0),
        permalink: String(v.share_url ?? ''),
      }));
    },
  };
}
```

```ts
// tests/fakes/oauth-provider.fake.ts
import type { OAuthProviderClient, OAuthTokenSet } from '@/lib/oauth/types';
import type { ProfilePost } from '@/lib/integrations/scraper';

export function createFakeOAuthProviderClient(overrides: Partial<OAuthProviderClient> = {}): OAuthProviderClient {
  const defaultTokenSet: OAuthTokenSet = {
    accessToken: 'fake-access-token',
    refreshToken: 'fake-refresh-token',
    expiresAt: null,
  };
  const defaultPosts: ProfilePost[] = [];
  return {
    buildAuthorizeUrl: (state, redirectUri) => `https://provider.example.com/authorize?state=${state}&redirect_uri=${redirectUri}`,
    exchangeCode: async () => defaultTokenSet,
    getProviderUserId: async () => 'fake-provider-user-id',
    refreshAccessToken: async () => defaultTokenSet,
    fetchProfilePosts: async () => defaultPosts,
    ...overrides,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/integrations/tiktok-oauth.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/oauth/types.ts lib/integrations/tiktok-oauth.ts tests/fakes/oauth-provider.fake.ts tests/unit/lib/integrations/tiktok-oauth.test.ts
git commit -m "feat: add shared OAuth provider interface and TikTok OAuth client"
```

---

### Task 4: `lib/integrations/instagram-oauth.ts`

**Files:**
- Create: `lib/integrations/instagram-oauth.ts`
- Test: `tests/unit/lib/integrations/instagram-oauth.test.ts`

**Interfaces:**
- Consumes: `OAuthProviderClient`, `OAuthTokenSet` from `@/lib/oauth/types` (Task 3); `ProfilePost` from `@/lib/integrations/scraper` (existing)
- Produces: `createInstagramOAuthClient(clientId, clientSecret)` — relied on by Task 8's routes and Task 10's route wiring

**⚠️ Live-doc check before finalizing this task:** Instagram's OAuth authorize/token/refresh endpoint URLs and the `instagram_business_basic` scope name are written from the platform's current documented shape as of this plan's writing — confirm against https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login before shipping, per this plan's Global Constraints.

**Known limitation, not a defect to fix in this task:** Instagram's Graph API media-list endpoint does not expose view/play counts on the fields this client requests (a separate Insights permission would be needed). `fetchProfilePosts` below sets `viewCount: 0` for every Instagram OAuth-fetched post, with a comment explaining why — the Apify path (used for any creator who hasn't connected Instagram) is unaffected and keeps returning real view counts. This is a real, known behavior difference worth surfacing to your human partner as a finding if you notice it during review, not something to silently work around.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lib/integrations/instagram-oauth.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createInstagramOAuthClient } from '@/lib/integrations/instagram-oauth';

describe('createInstagramOAuthClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds an authorize URL with the client id, scope, redirect_uri, and state', () => {
    const client = createInstagramOAuthClient('test-client-id', 'test-client-secret');
    const url = new URL(client.buildAuthorizeUrl('nonce-123', 'https://app.example.com/api/oauth/instagram/callback'));
    expect(url.hostname).toBe('api.instagram.com');
    expect(url.searchParams.get('client_id')).toBe('test-client-id');
    expect(url.searchParams.get('state')).toBe('nonce-123');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.example.com/api/oauth/instagram/callback');
  });

  it('exchanges a code for a short-lived token, then exchanges that for a long-lived token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ access_token: 'short-lived-1' }) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'long-lived-1', expires_in: 5184000 }), // ~60 days
      });
    vi.stubGlobal('fetch', fetchMock);

    const client = createInstagramOAuthClient('test-client-id', 'test-client-secret');
    const before = Date.now();
    const tokenSet = await client.exchangeCode('auth-code', 'https://app.example.com/api/oauth/instagram/callback');

    expect(tokenSet.accessToken).toBe('long-lived-1');
    expect(tokenSet.refreshToken).toBeNull();
    expect(tokenSet.expiresAt!.getTime()).toBeGreaterThan(before);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondCallUrl = new URL(String(fetchMock.mock.calls[1][0]));
    expect(secondCallUrl.searchParams.get('access_token')).toBe('short-lived-1');
    expect(secondCallUrl.searchParams.get('grant_type')).toBe('ig_exchange_token');
  });

  it('throws when the short-lived token exchange fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400 }));
    const client = createInstagramOAuthClient('test-client-id', 'test-client-secret');
    await expect(client.exchangeCode('bad-code', 'https://app.example.com/callback')).rejects.toThrow(
      'Instagram token exchange failed'
    );
  });

  it('fetches the provider user id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ user_id: 'ig-user-1' }) }));
    const client = createInstagramOAuthClient('test-client-id', 'test-client-secret');
    const userId = await client.getProviderUserId('access-1');
    expect(userId).toBe('ig-user-1');
  });

  it('refreshes a long-lived access token by presenting itself, with no separate refresh token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ access_token: 'refreshed-1', expires_in: 5184000 }) })
    );
    const client = createInstagramOAuthClient('test-client-id', 'test-client-secret');
    const refreshed = await client.refreshAccessToken({ accessToken: 'current-token', refreshToken: null, expiresAt: null });
    expect(refreshed.accessToken).toBe('refreshed-1');
    expect(refreshed.refreshToken).toBeNull();
  });

  it('fetches and normalizes profile posts, with viewCount always 0 (known API limitation)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              id: '17900000000000001',
              caption: 'New drop today',
              timestamp: '2026-08-06T10:00:00+0000',
              like_count: 500,
              comments_count: 20,
              permalink: 'https://www.instagram.com/p/abc123/',
            },
          ],
        }),
      })
    );
    const client = createInstagramOAuthClient('test-client-id', 'test-client-secret');
    const posts = await client.fetchProfilePosts('access-1');
    expect(posts).toEqual([
      {
        platform: 'instagram',
        id: '17900000000000001',
        caption: 'New drop today',
        publishedAt: '2026-08-06T10:00:00+0000',
        viewCount: 0,
        likeCount: 500,
        commentCount: 20,
        permalink: 'https://www.instagram.com/p/abc123/',
      },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/integrations/instagram-oauth.test.ts`
Expected: FAIL with `Cannot find module '@/lib/integrations/instagram-oauth'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/integrations/instagram-oauth.ts
import type { ProfilePost } from './scraper';
import type { OAuthProviderClient, OAuthTokenSet } from '@/lib/oauth/types';

const AUTHORIZE_URL = 'https://api.instagram.com/oauth/authorize';
const SHORT_LIVED_TOKEN_URL = 'https://api.instagram.com/oauth/access_token';
const LONG_LIVED_EXCHANGE_URL = 'https://graph.instagram.com/access_token';
const REFRESH_URL = 'https://graph.instagram.com/refresh_access_token';
const USER_INFO_URL = 'https://graph.instagram.com/me';
const MEDIA_URL = 'https://graph.instagram.com/me/media';

// Confirm current scope names against
// https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login
// before shipping. See this plan's Global Constraints.
const SCOPES = 'instagram_business_basic';

// Mirrors PROFILE_SCRAPE_RESULTS_LIMIT in lib/integrations/scraper.ts —
// see spec §4.
const PROFILE_POSTS_MAX_RESULTS = 50;

function parseExpiresAt(expiresInSeconds: number | undefined): Date | null {
  if (!expiresInSeconds) return null;
  return new Date(Date.now() + expiresInSeconds * 1000);
}

export function createInstagramOAuthClient(clientId: string, clientSecret: string): OAuthProviderClient {
  return {
    buildAuthorizeUrl(state: string, redirectUri: string): string {
      const url = new URL(AUTHORIZE_URL);
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('scope', SCOPES);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('state', state);
      return url.toString();
    },

    async exchangeCode(code: string, redirectUri: string): Promise<OAuthTokenSet> {
      const shortLivedResponse = await fetch(SHORT_LIVED_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
          code,
        }),
      });
      if (!shortLivedResponse.ok) {
        throw new Error(`Instagram token exchange failed with status ${shortLivedResponse.status}`);
      }
      const shortLivedData = await shortLivedResponse.json();

      // Instagram issues a short-lived (~1 hour) token first; it must be
      // exchanged once for a long-lived (~60 day) token before storing —
      // there is no separate refresh_token grant here. See spec §3.
      const longLivedUrl = new URL(LONG_LIVED_EXCHANGE_URL);
      longLivedUrl.searchParams.set('grant_type', 'ig_exchange_token');
      longLivedUrl.searchParams.set('client_secret', clientSecret);
      longLivedUrl.searchParams.set('access_token', shortLivedData.access_token);
      const longLivedResponse = await fetch(longLivedUrl.toString());
      if (!longLivedResponse.ok) {
        throw new Error(`Instagram long-lived token exchange failed with status ${longLivedResponse.status}`);
      }
      const longLivedData = await longLivedResponse.json();

      return {
        accessToken: longLivedData.access_token,
        refreshToken: null,
        expiresAt: parseExpiresAt(longLivedData.expires_in),
      };
    },

    async getProviderUserId(accessToken: string): Promise<string> {
      const url = new URL(USER_INFO_URL);
      url.searchParams.set('fields', 'user_id');
      url.searchParams.set('access_token', accessToken);
      const response = await fetch(url.toString());
      if (!response.ok) {
        throw new Error(`Instagram user info request failed with status ${response.status}`);
      }
      const data = await response.json();
      if (!data.user_id) {
        throw new Error('Instagram user info response did not include user_id');
      }
      return String(data.user_id);
    },

    async refreshAccessToken(current: OAuthTokenSet): Promise<OAuthTokenSet> {
      // Instagram's long-lived token refreshes by presenting itself, not a
      // separate refresh token — see spec §3.
      const url = new URL(REFRESH_URL);
      url.searchParams.set('grant_type', 'ig_refresh_token');
      url.searchParams.set('access_token', current.accessToken);
      const response = await fetch(url.toString());
      if (!response.ok) {
        throw new Error(`Instagram token refresh failed with status ${response.status}`);
      }
      const data = await response.json();
      return {
        accessToken: data.access_token,
        refreshToken: null,
        expiresAt: parseExpiresAt(data.expires_in),
      };
    },

    async fetchProfilePosts(accessToken: string): Promise<ProfilePost[]> {
      const url = new URL(MEDIA_URL);
      url.searchParams.set('fields', 'id,caption,timestamp,like_count,comments_count,permalink');
      url.searchParams.set('limit', String(PROFILE_POSTS_MAX_RESULTS));
      url.searchParams.set('access_token', accessToken);
      const response = await fetch(url.toString());
      if (!response.ok) {
        throw new Error(`Instagram media list request failed with status ${response.status}`);
      }
      const data = await response.json();
      const items: Array<Record<string, unknown>> = data.data ?? [];
      return items.map((item) => ({
        platform: 'instagram' as const,
        id: String(item.id),
        caption: String(item.caption ?? ''),
        publishedAt: String(item.timestamp),
        // Instagram Graph API's media-list fields don't expose view/play
        // counts (that needs a separate Insights permission this client
        // doesn't request) — a known, documented gap versus the Apify
        // path, not a bug. See this task's "Known limitation" note.
        viewCount: 0,
        likeCount: Number(item.like_count ?? 0),
        commentCount: Number(item.comments_count ?? 0),
        permalink: String(item.permalink ?? ''),
      }));
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/integrations/instagram-oauth.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/integrations/instagram-oauth.ts tests/unit/lib/integrations/instagram-oauth.test.ts
git commit -m "feat: add Instagram OAuth client"
```

---

### Task 5: `lib/oauth/state.ts` — nonce generation for CSRF protection

**Files:**
- Create: `lib/oauth/state.ts`
- Test: `tests/unit/lib/oauth/state.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `generateOAuthState()`, `oauthStateCookieName(platform)` — relied on by Task 8's routes

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lib/oauth/state.test.ts
import { describe, it, expect } from 'vitest';
import { generateOAuthState, oauthStateCookieName } from '@/lib/oauth/state';

describe('generateOAuthState', () => {
  it('generates a non-empty hex string', () => {
    const state = generateOAuthState();
    expect(state).toMatch(/^[a-f0-9]+$/);
    expect(state.length).toBeGreaterThan(16);
  });

  it('generates a different value on each call', () => {
    expect(generateOAuthState()).not.toBe(generateOAuthState());
  });
});

describe('oauthStateCookieName', () => {
  it('namespaces the cookie name by platform', () => {
    expect(oauthStateCookieName('tiktok')).toBe('oauth_state_tiktok');
    expect(oauthStateCookieName('instagram')).toBe('oauth_state_instagram');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/oauth/state.test.ts`
Expected: FAIL with `Cannot find module '@/lib/oauth/state'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/oauth/state.ts
import { randomBytes } from 'node:crypto';

const OAUTH_STATE_COOKIE_PREFIX = 'oauth_state_';

export function oauthStateCookieName(platform: string): string {
  return `${OAUTH_STATE_COOKIE_PREFIX}${platform}`;
}

/**
 * A random nonce used as the OAuth `state` param — proves a callback is a
 * continuation of an authorize request this app actually issued (CSRF
 * protection), checked against a short-lived cookie set at authorize time.
 * See docs/superpowers/specs/2026-08-14-oauth-fast-follow-design.md §2.
 */
export function generateOAuthState(): string {
  return randomBytes(16).toString('hex');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/oauth/state.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/oauth/state.ts tests/unit/lib/oauth/state.test.ts
git commit -m "feat: add OAuth state-nonce generation for CSRF protection"
```

---

### Task 6: `lib/oauth/handler.ts` — `handleOAuthCallback`

**Files:**
- Create: `lib/oauth/handler.ts`
- Test: `tests/unit/lib/oauth/handler.test.ts`

**Interfaces:**
- Consumes: `OAuthProviderClient`, `OAuthPlatform` from `@/lib/oauth/types` (Task 3); `createFakeOAuthProviderClient` (Task 3, test only)
- Produces: `OAuthCallbackDeps`, `OAuthCallbackContext`, `OAuthCallbackResult`, `handleOAuthCallback(deps, context)` — relied on by Task 8's callback route

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lib/oauth/handler.test.ts
import { describe, it, expect, vi } from 'vitest';
import { handleOAuthCallback } from '@/lib/oauth/handler';
import { createFakeOAuthProviderClient } from '../../../fakes/oauth-provider.fake';

function makeContext(overrides: Partial<Parameters<typeof handleOAuthCallback>[1]> = {}) {
  return {
    platform: 'tiktok' as const,
    profileId: 'profile-1',
    code: 'auth-code',
    error: null,
    state: 'nonce-123',
    expectedState: 'nonce-123',
    redirectUri: 'https://app.example.com/api/oauth/tiktok/callback',
    origin: 'https://app.example.com',
    ...overrides,
  };
}

describe('handleOAuthCallback', () => {
  it('redirects to /recap?oauthError=not_signed_in when there is no profile', async () => {
    const result = await handleOAuthCallback(
      { providerClient: createFakeOAuthProviderClient(), saveConnection: vi.fn() },
      makeContext({ profileId: null })
    );
    expect(result.redirectUrl).toBe('https://app.example.com/recap?oauthError=not_signed_in');
  });

  it('redirects to /recap?oauthError=denied when the provider reports an error, without exchanging a code', async () => {
    const saveConnection = vi.fn();
    const result = await handleOAuthCallback(
      { providerClient: createFakeOAuthProviderClient(), saveConnection },
      makeContext({ error: 'access_denied' })
    );
    expect(result.redirectUrl).toBe('https://app.example.com/recap?oauthError=denied');
    expect(saveConnection).not.toHaveBeenCalled();
  });

  it('redirects to /recap?oauthError=invalid_state when the state does not match the cookie', async () => {
    const saveConnection = vi.fn();
    const result = await handleOAuthCallback(
      { providerClient: createFakeOAuthProviderClient(), saveConnection },
      makeContext({ state: 'nonce-123', expectedState: 'different-nonce' })
    );
    expect(result.redirectUrl).toBe('https://app.example.com/recap?oauthError=invalid_state');
    expect(saveConnection).not.toHaveBeenCalled();
  });

  it('redirects to /recap?oauthError=invalid_state when there is no expected state cookie at all', async () => {
    const result = await handleOAuthCallback(
      { providerClient: createFakeOAuthProviderClient(), saveConnection: vi.fn() },
      makeContext({ expectedState: null })
    );
    expect(result.redirectUrl).toBe('https://app.example.com/recap?oauthError=invalid_state');
  });

  it('exchanges the code, saves the connection, and redirects to /recap?connected=<platform> on success', async () => {
    const providerClient = createFakeOAuthProviderClient({
      exchangeCode: async () => ({ accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: null }),
      getProviderUserId: async () => 'provider-user-1',
    });
    const saveConnection = vi.fn().mockResolvedValue(undefined);
    const result = await handleOAuthCallback({ providerClient, saveConnection }, makeContext());

    expect(saveConnection).toHaveBeenCalledWith({
      profileId: 'profile-1',
      platform: 'tiktok',
      providerUserId: 'provider-user-1',
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: null,
    });
    expect(result.redirectUrl).toBe('https://app.example.com/recap?connected=tiktok');
  });

  it('redirects to /recap?oauthError=exchange_failed when the code exchange throws', async () => {
    const providerClient = createFakeOAuthProviderClient({
      exchangeCode: async () => {
        throw new Error('network error');
      },
    });
    const result = await handleOAuthCallback({ providerClient, saveConnection: vi.fn() }, makeContext());
    expect(result.redirectUrl).toBe('https://app.example.com/recap?oauthError=exchange_failed');
  });

  it('redirects to /recap?oauthError=exchange_failed when there is no code and no provider error', async () => {
    const result = await handleOAuthCallback(
      { providerClient: createFakeOAuthProviderClient(), saveConnection: vi.fn() },
      makeContext({ code: null })
    );
    expect(result.redirectUrl).toBe('https://app.example.com/recap?oauthError=exchange_failed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/oauth/handler.test.ts`
Expected: FAIL with `Cannot find module '@/lib/oauth/handler'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/oauth/handler.ts
import type { OAuthPlatform, OAuthProviderClient } from './types';

export interface OAuthCallbackDeps {
  providerClient: OAuthProviderClient;
  saveConnection: (params: {
    profileId: string;
    platform: OAuthPlatform;
    providerUserId: string;
    accessToken: string;
    refreshToken: string | null;
    expiresAt: Date | null;
  }) => Promise<void>;
}

export interface OAuthCallbackContext {
  platform: OAuthPlatform;
  profileId: string | null;
  code: string | null;
  error: string | null;
  state: string | null;
  expectedState: string | null;
  redirectUri: string;
  origin: string;
}

export interface OAuthCallbackResult {
  redirectUrl: string;
}

function buildErrorRedirect(origin: string, errorCode: string): string {
  const url = new URL('/recap', origin);
  url.searchParams.set('oauthError', errorCode);
  return url.toString();
}

export async function handleOAuthCallback(deps: OAuthCallbackDeps, context: OAuthCallbackContext): Promise<OAuthCallbackResult> {
  if (!context.profileId) {
    return { redirectUrl: buildErrorRedirect(context.origin, 'not_signed_in') };
  }

  if (context.error) {
    return { redirectUrl: buildErrorRedirect(context.origin, 'denied') };
  }

  if (!context.state || !context.expectedState || context.state !== context.expectedState) {
    return { redirectUrl: buildErrorRedirect(context.origin, 'invalid_state') };
  }

  if (!context.code) {
    return { redirectUrl: buildErrorRedirect(context.origin, 'exchange_failed') };
  }

  try {
    const tokenSet = await deps.providerClient.exchangeCode(context.code, context.redirectUri);
    const providerUserId = await deps.providerClient.getProviderUserId(tokenSet.accessToken);
    await deps.saveConnection({
      profileId: context.profileId,
      platform: context.platform,
      providerUserId,
      accessToken: tokenSet.accessToken,
      refreshToken: tokenSet.refreshToken,
      expiresAt: tokenSet.expiresAt,
    });
  } catch (err) {
    console.error(`OAuth callback failed for ${context.platform}:`, err);
    return { redirectUrl: buildErrorRedirect(context.origin, 'exchange_failed') };
  }

  const successUrl = new URL('/recap', context.origin);
  successUrl.searchParams.set('connected', context.platform);
  return { redirectUrl: successUrl.toString() };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/oauth/handler.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/oauth/handler.ts tests/unit/lib/oauth/handler.test.ts
git commit -m "feat: add OAuth callback handler with state validation"
```

---

### Task 7: `lib/oauth/connections.ts` — refresh-aware read + disconnect

**Files:**
- Create: `lib/oauth/connections.ts`
- Test: `tests/unit/lib/oauth/connections.test.ts`

**Interfaces:**
- Consumes: `decryptToken` from `@/lib/crypto` (Task 2); `OAuthPlatform`, `OAuthProviderClient` from `@/lib/oauth/types` (Task 3); `encryptToken` from `@/lib/crypto` (Task 2, test only); `createFakeOAuthProviderClient` (Task 3, test only)
- Produces: `PlatformConnectionRow`, `GetPlatformConnectionDeps`, `ActiveConnection`, `getPlatformConnection(deps, profileId, platform, now?)`, `DisconnectPlatformDeps`, `disconnectPlatform(deps, profileId, platform)` — relied on by Task 9's `lib/recap/handler.ts` and Task 8/10's route wiring

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lib/oauth/connections.test.ts
import { describe, it, expect, vi } from 'vitest';
import { getPlatformConnection, disconnectPlatform } from '@/lib/oauth/connections';
import { encryptToken } from '@/lib/crypto';
import { createFakeOAuthProviderClient } from '../../../fakes/oauth-provider.fake';

const TEST_KEY = '0'.repeat(64);
const NOW = new Date('2026-08-14T12:00:00Z');

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    profileId: 'profile-1',
    platform: 'tiktok' as const,
    providerUserId: 'provider-user-1',
    accessTokenEncrypted: encryptToken('valid-access-token', TEST_KEY),
    refreshTokenEncrypted: encryptToken('valid-refresh-token', TEST_KEY),
    expiresAt: new Date('2026-08-15T12:00:00Z'), // well in the future relative to NOW
    ...overrides,
  };
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    providerClients: { tiktok: createFakeOAuthProviderClient(), instagram: createFakeOAuthProviderClient() },
    encryptionKey: TEST_KEY,
    getConnectionRow: async () => null,
    updateConnectionTokens: vi.fn(),
    deleteConnection: vi.fn(),
    ...overrides,
  };
}

describe('getPlatformConnection', () => {
  it('returns null when there is no connection row', async () => {
    const result = await getPlatformConnection(makeDeps(), 'profile-1', 'tiktok', NOW);
    expect(result).toBeNull();
  });

  it('returns the decrypted access token without refreshing when the token is not near expiry', async () => {
    const refreshAccessToken = vi.fn();
    const deps = makeDeps({
      providerClients: { tiktok: createFakeOAuthProviderClient({ refreshAccessToken }), instagram: createFakeOAuthProviderClient() },
      getConnectionRow: async () => makeRow(),
    });
    const result = await getPlatformConnection(deps, 'profile-1', 'tiktok', NOW);
    expect(result).toEqual({ accessToken: 'valid-access-token' });
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it('refreshes and returns the new access token when the token is within the expiry buffer', async () => {
    const updateConnectionTokens = vi.fn().mockResolvedValue(undefined);
    const providerClient = createFakeOAuthProviderClient({
      refreshAccessToken: async () => ({ accessToken: 'refreshed-access-token', refreshToken: 'refreshed-refresh-token', expiresAt: null }),
    });
    const row = makeRow({ expiresAt: new Date('2026-08-14T12:03:00Z') }); // 3 minutes out, within the 5-minute buffer
    const deps = makeDeps({
      providerClients: { tiktok: providerClient, instagram: createFakeOAuthProviderClient() },
      getConnectionRow: async () => row,
      updateConnectionTokens,
    });

    const result = await getPlatformConnection(deps, 'profile-1', 'tiktok', NOW);
    expect(result).toEqual({ accessToken: 'refreshed-access-token' });
    expect(updateConnectionTokens).toHaveBeenCalledWith({
      profileId: 'profile-1',
      platform: 'tiktok',
      accessToken: 'refreshed-access-token',
      refreshToken: 'refreshed-refresh-token',
      expiresAt: null,
    });
  });

  it('deletes the connection and returns null when refresh fails', async () => {
    const deleteConnection = vi.fn().mockResolvedValue(undefined);
    const providerClient = createFakeOAuthProviderClient({
      refreshAccessToken: async () => {
        throw new Error('refresh token expired');
      },
    });
    const row = makeRow({ expiresAt: new Date('2026-08-14T12:00:00Z') }); // already expired
    const deps = makeDeps({
      providerClients: { tiktok: providerClient, instagram: createFakeOAuthProviderClient() },
      getConnectionRow: async () => row,
      deleteConnection,
    });

    const result = await getPlatformConnection(deps, 'profile-1', 'tiktok', NOW);
    expect(result).toBeNull();
    expect(deleteConnection).toHaveBeenCalledWith('profile-1', 'tiktok');
  });
});

describe('disconnectPlatform', () => {
  it('deletes the connection row', async () => {
    const deleteConnection = vi.fn().mockResolvedValue(undefined);
    await disconnectPlatform({ deleteConnection }, 'profile-1', 'tiktok');
    expect(deleteConnection).toHaveBeenCalledWith('profile-1', 'tiktok');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/oauth/connections.test.ts`
Expected: FAIL with `Cannot find module '@/lib/oauth/connections'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/oauth/connections.ts
import { decryptToken } from '@/lib/crypto';
import type { OAuthPlatform, OAuthProviderClient } from './types';

export interface PlatformConnectionRow {
  profileId: string;
  platform: OAuthPlatform;
  providerUserId: string;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string | null;
  expiresAt: Date | null;
}

export interface GetPlatformConnectionDeps {
  providerClients: Record<OAuthPlatform, OAuthProviderClient>;
  encryptionKey: string;
  getConnectionRow: (profileId: string, platform: OAuthPlatform) => Promise<PlatformConnectionRow | null>;
  updateConnectionTokens: (params: {
    profileId: string;
    platform: OAuthPlatform;
    accessToken: string;
    refreshToken: string | null;
    expiresAt: Date | null;
  }) => Promise<void>;
  deleteConnection: (profileId: string, platform: OAuthPlatform) => Promise<void>;
}

export interface ActiveConnection {
  accessToken: string;
}

// Refresh proactively once a token is within this window of expiring, not
// only after it has already expired — avoids a request that starts
// mid-generation with a token that expires before the platform responds.
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

function needsRefresh(expiresAt: Date | null, now: Date): boolean {
  if (!expiresAt) return false;
  return expiresAt.getTime() - now.getTime() < REFRESH_BUFFER_MS;
}

/**
 * Reads a creator's connection for a platform, refreshing the token first
 * if it's expired or about to expire. Returns null if there's no
 * connection, or if refresh was needed and failed — in the failure case
 * the broken row is deleted so /recap reflects "disconnected" on next
 * load. See docs/superpowers/specs/2026-08-14-oauth-fast-follow-design.md §3.
 */
export async function getPlatformConnection(
  deps: GetPlatformConnectionDeps,
  profileId: string,
  platform: OAuthPlatform,
  now: Date = new Date()
): Promise<ActiveConnection | null> {
  const row = await deps.getConnectionRow(profileId, platform);
  if (!row) return null;

  const accessToken = decryptToken(row.accessTokenEncrypted, deps.encryptionKey);

  if (!needsRefresh(row.expiresAt, now)) {
    return { accessToken };
  }

  const refreshToken = row.refreshTokenEncrypted ? decryptToken(row.refreshTokenEncrypted, deps.encryptionKey) : null;

  try {
    const providerClient = deps.providerClients[platform];
    const refreshed = await providerClient.refreshAccessToken({ accessToken, refreshToken, expiresAt: row.expiresAt });
    await deps.updateConnectionTokens({
      profileId,
      platform,
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      expiresAt: refreshed.expiresAt,
    });
    return { accessToken: refreshed.accessToken };
  } catch (err) {
    console.error(`Failed to refresh ${platform} token for profile ${profileId}, clearing connection:`, err);
    await deps.deleteConnection(profileId, platform);
    return null;
  }
}

export interface DisconnectPlatformDeps {
  deleteConnection: (profileId: string, platform: OAuthPlatform) => Promise<void>;
}

export async function disconnectPlatform(deps: DisconnectPlatformDeps, profileId: string, platform: OAuthPlatform): Promise<void> {
  await deps.deleteConnection(profileId, platform);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/oauth/connections.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/oauth/connections.ts tests/unit/lib/oauth/connections.test.ts
git commit -m "feat: add refresh-aware connection lookup and disconnect"
```

---

### Task 8: `app/api/oauth/[platform]/{authorize,callback,disconnect}/route.ts` + `.env.example`

**Files:**
- Create: `app/api/oauth/[platform]/authorize/route.ts`
- Create: `app/api/oauth/[platform]/callback/route.ts`
- Create: `app/api/oauth/[platform]/disconnect/route.ts`
- Modify: `.env.example`
- Test: `tests/unit/app/api/oauth/route.test.ts`

**Interfaces:**
- Consumes: `createSupabaseServerClient`, `createSupabaseServiceRoleClient` (existing); `createTikTokOAuthClient` (Task 3); `createInstagramOAuthClient` (Task 4); `generateOAuthState`, `oauthStateCookieName` (Task 5); `handleOAuthCallback` (Task 6); `disconnectPlatform` (Task 7); `encryptToken` (Task 2); `OAuthPlatform` (Task 3)
- Produces: `GET /api/oauth/[platform]/authorize`, `GET /api/oauth/[platform]/callback`, `POST /api/oauth/[platform]/disconnect` — relied on by Task 11's `/recap` page UI

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/app/api/oauth/route.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getUserMock = vi.fn();
const fromMock = vi.fn();
const cookieStore = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
  createSupabaseServiceRoleClient: vi.fn(() => ({ from: fromMock })),
}));

vi.mock('next/headers', () => ({
  cookies: async () => cookieStore,
}));

import { GET as authorizeGET } from '@/app/api/oauth/[platform]/authorize/route';
import { GET as callbackGET } from '@/app/api/oauth/[platform]/callback/route';
import { POST as disconnectPOST } from '@/app/api/oauth/[platform]/disconnect/route';

function makeParams(platform: string) {
  return { params: Promise.resolve({ platform }) };
}

beforeEach(() => {
  getUserMock.mockReset();
  fromMock.mockReset();
  cookieStore.get.mockReset();
  cookieStore.set.mockReset();
  cookieStore.delete.mockReset();
  process.env.TIKTOK_CLIENT_ID = 'test-tiktok-client-id';
  process.env.TIKTOK_CLIENT_SECRET = 'test-tiktok-client-secret';
  process.env.OAUTH_TOKEN_ENCRYPTION_KEY = '0'.repeat(64);
});

describe('GET /api/oauth/[platform]/authorize', () => {
  it('returns 401 when signed out', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const response = await authorizeGET(new Request('https://app.example.com/api/oauth/tiktok/authorize'), makeParams('tiktok'));
    expect(response.status).toBe(401);
  });

  it('returns 400 for an unsupported platform', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const response = await authorizeGET(new Request('https://app.example.com/api/oauth/youtube/authorize'), makeParams('youtube'));
    expect(response.status).toBe(400);
  });

  it('sets a state cookie and redirects to the provider authorize URL when signed in', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const response = await authorizeGET(new Request('https://app.example.com/api/oauth/tiktok/authorize'), makeParams('tiktok'));
    expect(response.status).toBe(307); // NextResponse.redirect default
    expect(cookieStore.set).toHaveBeenCalledTimes(1);
    const [{ name, httpOnly }] = cookieStore.set.mock.calls[0];
    expect(name).toBe('oauth_state_tiktok');
    expect(httpOnly).toBe(true);
    expect(response.headers.get('location')).toContain('www.tiktok.com');
  });
});

describe('GET /api/oauth/[platform]/callback', () => {
  it('redirects to /recap?oauthError=invalid_state for an unsupported platform', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const response = await callbackGET(
      new Request('https://app.example.com/api/oauth/youtube/callback'),
      makeParams('youtube')
    );
    expect(response.headers.get('location')).toBe('https://app.example.com/recap?oauthError=invalid_state');
  });

  it('redirects to /recap?connected=tiktok and saves the connection on a successful round trip', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    cookieStore.get.mockReturnValue({ value: 'nonce-123' });
    const upsertMock = vi.fn().mockResolvedValue({ error: null });
    fromMock.mockReturnValue({ upsert: upsertMock });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 86400 }),
      })
    );

    // The second fetch call (getProviderUserId) needs a different shape —
    // stub sequentially since both calls share the same mocked fetch.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 86400 }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { user: { open_id: 'provider-user-1' } } }) });
    vi.stubGlobal('fetch', fetchMock);

    const response = await callbackGET(
      new Request('https://app.example.com/api/oauth/tiktok/callback?code=auth-code&state=nonce-123'),
      makeParams('tiktok')
    );

    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ profile_id: 'user-1', platform: 'tiktok', provider_user_id: 'provider-user-1' }),
      { onConflict: 'profile_id,platform' }
    );
    expect(response.headers.get('location')).toBe('https://app.example.com/recap?connected=tiktok');
    expect(cookieStore.delete).toHaveBeenCalledWith('oauth_state_tiktok');
    vi.unstubAllGlobals();
  });

  it('redirects to /recap?oauthError=invalid_state when the state cookie does not match', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    cookieStore.get.mockReturnValue({ value: 'a-different-nonce' });
    const response = await callbackGET(
      new Request('https://app.example.com/api/oauth/tiktok/callback?code=auth-code&state=nonce-123'),
      makeParams('tiktok')
    );
    expect(response.headers.get('location')).toBe('https://app.example.com/recap?oauthError=invalid_state');
  });
});

describe('POST /api/oauth/[platform]/disconnect', () => {
  it('returns 401 when signed out', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const response = await disconnectPOST(new Request('https://app.example.com/api/oauth/tiktok/disconnect', { method: 'POST' }), makeParams('tiktok'));
    expect(response.status).toBe(401);
  });

  it('deletes the connection row and returns ok when signed in', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const eqPlatform = vi.fn().mockResolvedValue({ error: null });
    const eqProfile = vi.fn(() => ({ eq: eqPlatform }));
    const deleteMock = vi.fn(() => ({ eq: eqProfile }));
    fromMock.mockReturnValue({ delete: deleteMock });

    const response = await disconnectPOST(new Request('https://app.example.com/api/oauth/tiktok/disconnect', { method: 'POST' }), makeParams('tiktok'));
    const body = await response.json();

    expect(body).toEqual({ ok: true });
    expect(deleteMock).toHaveBeenCalled();
    expect(eqProfile).toHaveBeenCalledWith('profile_id', 'user-1');
    expect(eqPlatform).toHaveBeenCalledWith('platform', 'tiktok');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/app/api/oauth/route.test.ts`
Expected: FAIL with `Cannot find module '@/app/api/oauth/[platform]/authorize/route'`

- [ ] **Step 3: Write minimal implementation**

```ts
// app/api/oauth/[platform]/authorize/route.ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createTikTokOAuthClient } from '@/lib/integrations/tiktok-oauth';
import { createInstagramOAuthClient } from '@/lib/integrations/instagram-oauth';
import { generateOAuthState, oauthStateCookieName } from '@/lib/oauth/state';
import type { OAuthPlatform, OAuthProviderClient } from '@/lib/oauth/types';

const STATE_COOKIE_MAX_AGE_SECONDS = 10 * 60; // 10 minutes — long enough for a real consent-screen round trip

function isSupportedPlatform(value: string): value is OAuthPlatform {
  return value === 'tiktok' || value === 'instagram';
}

function createProviderClient(platform: OAuthPlatform): OAuthProviderClient {
  if (platform === 'tiktok') {
    return createTikTokOAuthClient(process.env.TIKTOK_CLIENT_ID ?? '', process.env.TIKTOK_CLIENT_SECRET ?? '');
  }
  return createInstagramOAuthClient(process.env.INSTAGRAM_CLIENT_ID ?? '', process.env.INSTAGRAM_CLIENT_SECRET ?? '');
}

export async function GET(request: Request, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  if (!isSupportedPlatform(platform)) {
    return NextResponse.json({ error: 'Unsupported platform.' }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'You must be signed in to connect a platform.' }, { status: 401 });
  }

  const requestUrl = new URL(request.url);
  const redirectUri = `${requestUrl.origin}/api/oauth/${platform}/callback`;
  const state = generateOAuthState();

  const cookieStore = await cookies();
  cookieStore.set({
    name: oauthStateCookieName(platform),
    value: state,
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: STATE_COOKIE_MAX_AGE_SECONDS,
    path: '/',
  });

  const providerClient = createProviderClient(platform);
  return NextResponse.redirect(providerClient.buildAuthorizeUrl(state, redirectUri));
}
```

```ts
// app/api/oauth/[platform]/callback/route.ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { createTikTokOAuthClient } from '@/lib/integrations/tiktok-oauth';
import { createInstagramOAuthClient } from '@/lib/integrations/instagram-oauth';
import { encryptToken } from '@/lib/crypto';
import { oauthStateCookieName } from '@/lib/oauth/state';
import { handleOAuthCallback } from '@/lib/oauth/handler';
import type { OAuthPlatform, OAuthProviderClient } from '@/lib/oauth/types';

function isSupportedPlatform(value: string): value is OAuthPlatform {
  return value === 'tiktok' || value === 'instagram';
}

function createProviderClient(platform: OAuthPlatform): OAuthProviderClient {
  if (platform === 'tiktok') {
    return createTikTokOAuthClient(process.env.TIKTOK_CLIENT_ID ?? '', process.env.TIKTOK_CLIENT_SECRET ?? '');
  }
  return createInstagramOAuthClient(process.env.INSTAGRAM_CLIENT_ID ?? '', process.env.INSTAGRAM_CLIENT_SECRET ?? '');
}

export async function GET(request: Request, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  const requestUrl = new URL(request.url);

  if (!isSupportedPlatform(platform)) {
    return NextResponse.redirect(new URL('/recap?oauthError=invalid_state', requestUrl.origin));
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const cookieStore = await cookies();
  const cookieName = oauthStateCookieName(platform);
  const expectedState = cookieStore.get(cookieName)?.value ?? null;
  cookieStore.delete(cookieName);

  const serviceClient = createSupabaseServiceRoleClient();
  const encryptionKey = process.env.OAUTH_TOKEN_ENCRYPTION_KEY ?? '';

  const result = await handleOAuthCallback(
    {
      providerClient: createProviderClient(platform),
      saveConnection: async ({ profileId, platform: connectedPlatform, providerUserId, accessToken, refreshToken, expiresAt }) => {
        const { error } = await serviceClient.from('platform_connections').upsert(
          {
            profile_id: profileId,
            platform: connectedPlatform,
            provider_user_id: providerUserId,
            access_token_encrypted: encryptToken(accessToken, encryptionKey),
            refresh_token_encrypted: refreshToken ? encryptToken(refreshToken, encryptionKey) : null,
            expires_at: expiresAt ? expiresAt.toISOString() : null,
          },
          { onConflict: 'profile_id,platform' }
        );
        if (error) {
          throw new Error(`Failed to save platform connection: ${error.message}`);
        }
      },
    },
    {
      platform,
      profileId: user?.id ?? null,
      code: requestUrl.searchParams.get('code'),
      error: requestUrl.searchParams.get('error'),
      state: requestUrl.searchParams.get('state'),
      expectedState,
      redirectUri: `${requestUrl.origin}/api/oauth/${platform}/callback`,
      origin: requestUrl.origin,
    }
  );

  return NextResponse.redirect(result.redirectUrl);
}
```

```ts
// app/api/oauth/[platform]/disconnect/route.ts
import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { disconnectPlatform } from '@/lib/oauth/connections';
import type { OAuthPlatform } from '@/lib/oauth/types';

function isSupportedPlatform(value: string): value is OAuthPlatform {
  return value === 'tiktok' || value === 'instagram';
}

export async function POST(_request: Request, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  if (!isSupportedPlatform(platform)) {
    return NextResponse.json({ error: 'Unsupported platform.' }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'You must be signed in to disconnect a platform.' }, { status: 401 });
  }

  const serviceClient = createSupabaseServiceRoleClient();
  await disconnectPlatform(
    {
      deleteConnection: async (profileId, connectedPlatform) => {
        const { error } = await serviceClient
          .from('platform_connections')
          .delete()
          .eq('profile_id', profileId)
          .eq('platform', connectedPlatform);
        if (error) {
          throw new Error(`Failed to disconnect ${connectedPlatform}: ${error.message}`);
        }
      },
    },
    user.id,
    platform
  );

  return NextResponse.json({ ok: true });
}
```

Add to `.env.example`, after the existing `APIFY_API_TOKEN` block:

```
# Token encryption for OAuth connections — generate with `openssl rand -hex 32`
OAUTH_TOKEN_ENCRYPTION_KEY=

# TikTok for Developers — https://developers.tiktok.com
TIKTOK_CLIENT_ID=
TIKTOK_CLIENT_SECRET=

# Meta for Developers (Instagram Graph API) — https://developers.facebook.com
INSTAGRAM_CLIENT_ID=
INSTAGRAM_CLIENT_SECRET=
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/app/api/oauth/route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/oauth/ .env.example tests/unit/app/api/oauth/route.test.ts
git commit -m "feat: add OAuth authorize/callback/disconnect routes"
```

---

### Task 9: `lib/recap/handler.ts` — per-platform OAuth branching

**Files:**
- Modify: `lib/recap/handler.ts`
- Modify: `tests/unit/lib/recap/handler.test.ts`

**Interfaces:**
- Consumes: `getPlatformConnection`, `ActiveConnection` shape from `@/lib/oauth/connections` (Task 7, as a type reference only — the real function is wired in Task 10; this task's `RecapHandlerDeps` just declares the dependency shape); `ProfilePost` from `@/lib/integrations/scraper` (existing); `createFakeOAuthProviderClient` (Task 3, test only)
- Produces: `RecapHandlerDeps` gains `getPlatformConnection` and `oauthClients` fields — relied on by Task 10's route wiring

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/lib/recap/handler.test.ts`'s `makeDeps` helper (replace the existing `makeDeps` function with this one — it adds the two new fields with safe defaults so every existing test keeps passing unmodified):

```ts
function makeDeps(overrides: Partial<Parameters<typeof handleRecapRequest>[0]> = {}): RecapHandlerDeps {
  const savedCards: RecapCardRow[] = [];
  return {
    rateLimitStore: createInMemoryRateLimitStore(),
    youtubeClient: createFakeYouTubeClient(),
    scraperClient: createFakeScraperClient(),
    ipSalt: 'test-salt',
    getProfileHandles: async (): Promise<RecapHandles> => ({ youtube: 'creator', tiktok: null, instagram: null }),
    getExistingRecapCard: async () => null,
    saveRecapCard: async (params) => {
      const row: RecapCardRow = { id: `card-${savedCards.length + 1}`, profileId: params.profileId, month: params.month, platformData: params.platformData, totals: params.totals, topPost: params.topPost, warnings: params.warnings, generatedAt: '2026-08-13T00:00:00Z' };
      savedCards.push(row);
      return row;
    },
    getPlatformConnection: async () => null,
    oauthClients: {
      tiktok: createFakeOAuthProviderClient(),
      instagram: createFakeOAuthProviderClient(),
    },
    ...overrides,
  };
}
```

Add this import alongside the existing ones at the top of the file:

```ts
import { createFakeOAuthProviderClient } from '../../../fakes/oauth-provider.fake';
```

Append new test cases to the `describe('handleRecapRequest', ...)` block:

```ts
  it('uses the OAuth-connected platform instead of the Apify path when a connection exists', async () => {
    const scraperClient = createFakeScraperClient();
    const fetchProfilePostsSpy = vi.spyOn(scraperClient, 'fetchProfilePosts');
    const oauthFetchSpy = vi.fn(async () => [
      { platform: 'tiktok' as const, id: 'oauth-1', caption: 'via OAuth', publishedAt: '2026-08-06T00:00:00Z', viewCount: 5000, likeCount: 300, commentCount: 20, permalink: 'https://tiktok.com/@creator/video/oauth-1' },
    ]);
    const deps = makeDeps({
      scraperClient,
      getProfileHandles: async () => ({ youtube: null, tiktok: 'creator', instagram: null }),
      getPlatformConnection: async (_profileId, platform) => (platform === 'tiktok' ? { accessToken: 'access-1' } : null),
      oauthClients: {
        tiktok: createFakeOAuthProviderClient({ fetchProfilePosts: oauthFetchSpy }),
        instagram: createFakeOAuthProviderClient(),
      },
    });

    const result = await handleRecapRequest(deps, { profileId: 'p1', ip: '203.0.113.1', now: NOW });
    expect(result.status).toBe(200);
    expect(oauthFetchSpy).toHaveBeenCalledWith('access-1');
    expect(fetchProfilePostsSpy).not.toHaveBeenCalled();
    const body = result.body as { recapCard: RecapCardRow };
    expect(body.recapCard.totals.postCount).toBe(1);
  });

  it('falls back to the Apify/handle path when a platform has a handle but no connection', async () => {
    const deps = makeDeps({
      getProfileHandles: async () => ({ youtube: null, tiktok: 'creator', instagram: null }),
      scraperClient: createFakeScraperClient({}, [
        { platform: 'tiktok', id: 't1', caption: 'via Apify', publishedAt: '2026-08-06T00:00:00Z', viewCount: 100, likeCount: 5, commentCount: 1, permalink: 'https://tiktok.com/@creator/video/t1' },
      ]),
    });
    const result = await handleRecapRequest(deps, { profileId: 'p1', ip: '203.0.113.1', now: NOW });
    expect(result.status).toBe(200);
    const body = result.body as { recapCard: RecapCardRow };
    expect(body.recapCard.totals.postCount).toBe(1);
  });

  it('allows generation from a connection alone, with no handle saved for that platform', async () => {
    const deps = makeDeps({
      getProfileHandles: async () => ({ youtube: null, tiktok: null, instagram: null }),
      getPlatformConnection: async (_profileId, platform) => (platform === 'tiktok' ? { accessToken: 'access-1' } : null),
      oauthClients: {
        tiktok: createFakeOAuthProviderClient({
          fetchProfilePosts: async () => [
            { platform: 'tiktok' as const, id: 'oauth-1', caption: 'connected only', publishedAt: '2026-08-06T00:00:00Z', viewCount: 10, likeCount: 1, commentCount: 0, permalink: 'https://tiktok.com/@creator/video/oauth-1' },
          ],
        }),
        instagram: createFakeOAuthProviderClient(),
      },
    });
    const result = await handleRecapRequest(deps, { profileId: 'p1', ip: '203.0.113.1', now: NOW });
    expect(result.status).toBe(200);
  });

  it('rejects when neither a handle nor a connection exists for any platform', async () => {
    const deps = makeDeps({ getProfileHandles: async () => ({ youtube: null, tiktok: null, instagram: null }) });
    const result = await handleRecapRequest(deps, { profileId: 'p1', ip: '203.0.113.1', now: NOW });
    expect(result.status).toBe(400);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/recap/handler.test.ts`
Expected: FAIL — `RecapHandlerDeps` doesn't have `getPlatformConnection`/`oauthClients`, and the new assertions have nothing to exercise yet.

- [ ] **Step 3: Modify `lib/recap/handler.ts`**

Replace the file's full contents with:

```ts
import { checkAndRecordRateLimit, releaseRateLimitEventIfNeeded, hashIp, type RateLimitStore } from '@/lib/rate-limit';
import type { YouTubeClient } from '@/lib/integrations/youtube';
import type { ScraperClient, ProfilePost } from '@/lib/integrations/scraper';
import { filterPostsToMonth, aggregateRecap } from './aggregate';
import type { AggregatablePost, PlatformTotals, RecapCardRow, RecapHandles, RecapPlatform, RecapTopPost } from './types';

export const RECAP_GENERATION_PROFILE_LIMIT = 5;
export const RECAP_GENERATION_IP_LIMIT = 10;

type OAuthConnectedPlatform = 'tiktok' | 'instagram';

export interface RecapHandlerDeps {
  rateLimitStore: RateLimitStore;
  youtubeClient: YouTubeClient;
  scraperClient: ScraperClient;
  ipSalt: string;
  getProfileHandles: (profileId: string) => Promise<RecapHandles>;
  getExistingRecapCard: (profileId: string, month: string) => Promise<RecapCardRow | null>;
  saveRecapCard: (params: {
    profileId: string;
    month: string;
    platformData: Partial<Record<RecapPlatform, PlatformTotals>>;
    totals: PlatformTotals;
    topPost: RecapTopPost;
    warnings: string[];
  }) => Promise<RecapCardRow>;
  /**
   * Returns an active, refresh-if-needed access token for a connected
   * platform, or null if the platform isn't connected via OAuth (or the
   * connection was cleared after a failed refresh). See
   * docs/superpowers/specs/2026-08-14-oauth-fast-follow-design.md §4.
   */
  getPlatformConnection: (profileId: string, platform: OAuthConnectedPlatform) => Promise<{ accessToken: string } | null>;
  oauthClients: Record<OAuthConnectedPlatform, { fetchProfilePosts: (accessToken: string) => Promise<ProfilePost[]> }>;
}

export interface RecapRequestContext {
  profileId: string | null;
  ip: string;
  now: Date;
}

export interface RecapHandlerResult {
  status: number;
  body: Record<string, unknown>;
}

function monthKey(date: Date): { label: string; year: number; month: number } {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  return { label: `${year}-${String(month).padStart(2, '0')}-01`, year, month };
}

export async function handleRecapRequest(deps: RecapHandlerDeps, context: RecapRequestContext): Promise<RecapHandlerResult> {
  if (!context.profileId) {
    return { status: 401, body: { error: 'You must be signed in to generate a recap card.' } };
  }

  const handles = await deps.getProfileHandles(context.profileId);

  // Fetched once up front — both for the "is anything connected" gate
  // below and reused in the fetch loop, so a connected platform's token
  // is never refreshed twice in one request. See spec §4.
  const oauthConnections: Partial<Record<OAuthConnectedPlatform, { accessToken: string }>> = {};
  for (const platform of ['tiktok', 'instagram'] as const) {
    const connection = await deps.getPlatformConnection(context.profileId, platform);
    if (connection) {
      oauthConnections[platform] = connection;
    }
  }

  const connected = (['youtube', 'tiktok', 'instagram'] as const).filter(
    (p) => handles[p] || (p !== 'youtube' && oauthConnections[p as OAuthConnectedPlatform])
  );
  if (connected.length === 0) {
    return { status: 400, body: { error: 'Connect at least one platform before generating a recap.' } };
  }

  const { label: month, year, month: monthNum } = monthKey(context.now);

  const existing = await deps.getExistingRecapCard(context.profileId, month);
  if (existing) {
    return { status: 200, body: { recapCard: existing } };
  }

  const ipHash = hashIp(context.ip, deps.ipSalt);
  const rateLimitResult = await checkAndRecordRateLimit({
    store: deps.rateLimitStore,
    profileId: context.profileId,
    ipHash,
    eventType: 'recap_generation',
    profileLimit: RECAP_GENERATION_PROFILE_LIMIT,
    ipLimit: RECAP_GENERATION_IP_LIMIT,
    windowDays: 1,
    now: context.now,
  });

  if (!rateLimitResult.allowed) {
    return {
      status: 429,
      body: {
        error:
          rateLimitResult.reason === 'ip_limit'
            ? 'Too many recap generations have been requested from this network recently. Please try again later.'
            : "You've hit today's limit for recap generation attempts. Please try again tomorrow.",
        retryAfter: rateLimitResult.retryAfter?.toISOString(),
      },
    };
  }

  try {
    const warnings: string[] = [];
    const postsByPlatform: Partial<Record<RecapPlatform, AggregatablePost[]>> = {};

    if (handles.youtube) {
      try {
        const videos = await deps.youtubeClient.getChannelUploads(handles.youtube);
        postsByPlatform.youtube = filterPostsToMonth(
          videos.map((v) => ({
            platform: 'youtube' as const,
            captionOrTitle: v.title,
            publishedAt: v.publishedAt,
            viewCount: v.viewCount,
            likeCount: v.likeCount,
            commentCount: v.commentCount,
            permalink: `https://youtube.com/watch?v=${v.id}`,
          })),
          { year, month: monthNum }
        );
      } catch (err) {
        console.error('YouTube recap fetch failed:', err);
        warnings.push('youtube_scrape_failed');
      }
    }

    for (const platform of ['tiktok', 'instagram'] as const) {
      const handle = handles[platform];
      const connection = oauthConnections[platform];
      if (!connection && !handle) continue;
      try {
        const posts = connection
          ? await deps.oauthClients[platform].fetchProfilePosts(connection.accessToken)
          : await deps.scraperClient.fetchProfilePosts(platform, handle!);
        postsByPlatform[platform] = filterPostsToMonth(
          posts.map((p) => ({
            platform,
            captionOrTitle: p.caption,
            publishedAt: p.publishedAt,
            viewCount: p.viewCount,
            likeCount: p.likeCount,
            commentCount: p.commentCount,
            permalink: p.permalink,
          })),
          { year, month: monthNum }
        );
      } catch (err) {
        console.error(`${platform} recap fetch failed:`, err);
        warnings.push(`${platform}_scrape_failed`);
      }
    }

    const aggregation = aggregateRecap(postsByPlatform);
    if (!aggregation.topPost || aggregation.totals.postCount === 0) {
      if (warnings.length === connected.length) {
        // Every connected platform's fetch *threw*. That leaves
        // postsByPlatform empty exactly like a genuinely quiet month, but
        // it is our failure, not a real result — so the attempt is given
        // back, and the creator is told what actually happened rather
        // than being told they published nothing.
        await releaseRateLimitEventIfNeeded({ store: deps.rateLimitStore, eventId: rateLimitResult.eventId });
        return {
          status: 503,
          body: { error: "We couldn't reach any of your connected platforms. Please try again in a bit.", warnings },
        };
      }
      // A real, costly scrape ran and genuinely found nothing this
      // month — not our own failure, so the rate-limit event is NOT
      // released; it's a legitimate use of one of today's attempts. No
      // row is written, so a later attempt this month isn't blocked by
      // the (profile, month) unique constraint. See spec §2 step 5.
      return {
        status: 422,
        body: { error: "Looks like nothing was published on your connected platforms this month yet.", warnings },
      };
    }

    const saved = await deps.saveRecapCard({
      profileId: context.profileId,
      month,
      platformData: aggregation.platformData,
      totals: aggregation.totals,
      topPost: aggregation.topPost,
      warnings,
    });

    return { status: 200, body: { recapCard: saved } };
  } catch (err) {
    await releaseRateLimitEventIfNeeded({ store: deps.rateLimitStore, eventId: rateLimitResult.eventId });
    throw err;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/recap/handler.test.ts`
Expected: PASS (all existing tests plus the 4 new ones)

- [ ] **Step 5: Commit**

```bash
git add lib/recap/handler.ts tests/unit/lib/recap/handler.test.ts
git commit -m "feat: branch Recap Card generation per platform between OAuth and Apify"
```

---

### Task 10: `app/api/recap/route.ts` — wire connections into bootstrap + generation

**Files:**
- Modify: `app/api/recap/route.ts`

**Interfaces:**
- Consumes: `getPlatformConnection` from `@/lib/oauth/connections` (Task 7); `createTikTokOAuthClient` (Task 3), `createInstagramOAuthClient` (Task 4); `encryptToken` from `@/lib/crypto` (Task 2); `OAuthPlatform` from `@/lib/oauth/types` (Task 3); `RecapHandlerDeps`'s new fields (Task 9)
- Produces: `GET /api/recap` response gains `connections: { tiktok: boolean, instagram: boolean }`; `POST /api/recap` wires the real OAuth-backed `getPlatformConnection`/`oauthClients` — relied on by Task 11's `/recap` page

No new automated test for this task: this codebase doesn't unit-test `app/api/recap/route.ts` directly (only `lib/recap/handler.ts`, already covered in Task 9) — this route is thin wiring, verified by `npm run typecheck` and a manual read-through.

- [ ] **Step 1: Replace the file's full contents**

```ts
// app/api/recap/route.ts
import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { createSupabaseRateLimitStore } from '@/lib/supabase/rate-limit-store';
import { createYouTubeClient } from '@/lib/integrations/youtube';
import { createApifyScraperClient } from '@/lib/integrations/scraper';
import { createTikTokOAuthClient } from '@/lib/integrations/tiktok-oauth';
import { createInstagramOAuthClient } from '@/lib/integrations/instagram-oauth';
import { deriveClientIp } from '@/lib/ip';
import { handleRecapRequest } from '@/lib/recap/handler';
import { getPlatformConnection as lookupPlatformConnection } from '@/lib/oauth/connections';
import { encryptToken } from '@/lib/crypto';
import type { RecapCardRow } from '@/lib/recap/types';
import type { OAuthPlatform } from '@/lib/oauth/types';

function currentMonthKey(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function mapRecapCardRow(row: {
  id: string;
  profile_id: string;
  month: string;
  platform_data: unknown;
  totals: unknown;
  top_post: unknown;
  warnings: string[];
  generated_at: string;
}): RecapCardRow {
  return {
    id: row.id,
    profileId: row.profile_id,
    month: row.month,
    platformData: row.platform_data as RecapCardRow['platformData'],
    totals: row.totals as RecapCardRow['totals'],
    topPost: row.top_post as RecapCardRow['topPost'],
    warnings: row.warnings,
    generatedAt: row.generated_at,
  };
}

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'You must be signed in to view your recap settings.' }, { status: 401 });
  }

  const serviceClient = createSupabaseServiceRoleClient();
  const { data: profile } = await serviceClient
    .from('profiles')
    .select('youtube_channel_handle,tiktok_handle,instagram_handle')
    .eq('id', user.id)
    .single();

  const { data: existingCard } = await serviceClient
    .from('recap_cards')
    .select('id')
    .eq('profile_id', user.id)
    .eq('month', currentMonthKey(new Date()))
    .maybeSingle();

  const { data: connectionRows } = await serviceClient.from('platform_connections').select('platform').eq('profile_id', user.id);
  const connectedPlatforms = new Set((connectionRows ?? []).map((row) => row.platform));

  return NextResponse.json({
    handles: {
      youtube: profile?.youtube_channel_handle ?? null,
      tiktok: profile?.tiktok_handle ?? null,
      instagram: profile?.instagram_handle ?? null,
    },
    connections: {
      tiktok: connectedPlatforms.has('tiktok'),
      instagram: connectedPlatforms.has('instagram'),
    },
    recapCardId: existingCard?.id ?? null,
  });
}

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const serviceClient = createSupabaseServiceRoleClient();
    const ip = deriveClientIp({
      headers: request.headers,
      isTrustedPlatform: process.env.VERCEL === '1',
      trustedProxyHops: process.env.TRUSTED_PROXY_HOPS ? Number(process.env.TRUSTED_PROXY_HOPS) : undefined,
    });

    const encryptionKey = process.env.OAUTH_TOKEN_ENCRYPTION_KEY ?? '';
    const oauthProviderClients = {
      tiktok: createTikTokOAuthClient(process.env.TIKTOK_CLIENT_ID ?? '', process.env.TIKTOK_CLIENT_SECRET ?? ''),
      instagram: createInstagramOAuthClient(process.env.INSTAGRAM_CLIENT_ID ?? '', process.env.INSTAGRAM_CLIENT_SECRET ?? ''),
    };

    const result = await handleRecapRequest(
      {
        rateLimitStore: createSupabaseRateLimitStore(serviceClient),
        youtubeClient: createYouTubeClient(process.env.YOUTUBE_API_KEY ?? ''),
        scraperClient: createApifyScraperClient(process.env.APIFY_API_TOKEN ?? ''),
        ipSalt: process.env.RATE_LIMIT_IP_SALT ?? 'dev-salt',
        getProfileHandles: async (profileId) => {
          const { data } = await serviceClient
            .from('profiles')
            .select('youtube_channel_handle,tiktok_handle,instagram_handle')
            .eq('id', profileId)
            .single();
          return {
            youtube: data?.youtube_channel_handle ?? null,
            tiktok: data?.tiktok_handle ?? null,
            instagram: data?.instagram_handle ?? null,
          };
        },
        getExistingRecapCard: async (profileId, month) => {
          const { data } = await serviceClient
            .from('recap_cards')
            .select('*')
            .eq('profile_id', profileId)
            .eq('month', month)
            .maybeSingle();
          return data ? mapRecapCardRow(data) : null;
        },
        saveRecapCard: async ({ profileId, month, platformData, totals, topPost, warnings }) => {
          const { data, error } = await serviceClient
            .from('recap_cards')
            .insert({ profile_id: profileId, month, platform_data: platformData, totals, top_post: topPost, warnings })
            .select('*')
            .single();
          if (error || !data) {
            throw new Error(`Failed to save recap card: ${error?.message}`);
          }
          return mapRecapCardRow(data);
        },
        getPlatformConnection: (profileId, platform) =>
          lookupPlatformConnection(
            {
              providerClients: oauthProviderClients,
              encryptionKey,
              getConnectionRow: async (pid, p) => {
                const { data } = await serviceClient
                  .from('platform_connections')
                  .select('*')
                  .eq('profile_id', pid)
                  .eq('platform', p)
                  .maybeSingle();
                if (!data) return null;
                return {
                  profileId: data.profile_id,
                  platform: data.platform as OAuthPlatform,
                  providerUserId: data.provider_user_id,
                  accessTokenEncrypted: data.access_token_encrypted,
                  refreshTokenEncrypted: data.refresh_token_encrypted,
                  expiresAt: data.expires_at ? new Date(data.expires_at) : null,
                };
              },
              updateConnectionTokens: async ({ profileId: pid, platform: p, accessToken, refreshToken, expiresAt }) => {
                const { error } = await serviceClient
                  .from('platform_connections')
                  .update({
                    access_token_encrypted: encryptToken(accessToken, encryptionKey),
                    refresh_token_encrypted: refreshToken ? encryptToken(refreshToken, encryptionKey) : null,
                    expires_at: expiresAt ? expiresAt.toISOString() : null,
                  })
                  .eq('profile_id', pid)
                  .eq('platform', p);
                if (error) {
                  throw new Error(`Failed to update platform connection tokens: ${error.message}`);
                }
              },
              deleteConnection: async (pid, p) => {
                await serviceClient.from('platform_connections').delete().eq('profile_id', pid).eq('platform', p);
              },
            },
            profileId,
            platform
          ),
        oauthClients: oauthProviderClients,
      },
      { profileId: user?.id ?? null, ip, now: new Date() }
    );

    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    console.error('Recap generation failed:', err);
    return NextResponse.json({ error: 'Something went wrong generating your recap card. Please try again.' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify the project still typechecks**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 3: Run the full unit suite to confirm nothing else broke**

Run: `npx vitest run`
Expected: PASS (all files, including Task 9's updated `lib/recap/handler.test.ts`)

- [ ] **Step 4: Commit**

```bash
git add app/api/recap/route.ts
git commit -m "feat: wire OAuth connections into /api/recap bootstrap and generation"
```

---

### Task 11: `lib/recap/page-state.ts` + `app/recap/page.tsx` — connect/disconnect UI

**Files:**
- Modify: `lib/recap/page-state.ts`
- Modify: `app/recap/page.tsx`
- Modify: `tests/unit/lib/recap/page-state.test.ts`

**Interfaces:**
- Consumes: nothing new from earlier tasks in this plan (this task is pure UI/state-machine wiring against the `GET /api/recap` and `POST /api/oauth/[platform]/disconnect` response shapes Tasks 8 and 10 already produce)
- Produces: `RecapConnectionStatus`, `EMPTY_CONNECTIONS`, `hasAnyConnection`, updated `RecapPageState`/`RecapPageEvent` (new `connections` field on every handle-editing state, new `DISCONNECTED` event) — this is the plan's final consumer-facing surface, nothing later depends on it

- [ ] **Step 1: Write the failing test**

Replace `tests/unit/lib/recap/page-state.test.ts`'s existing import block (its first 7 lines) with:

```ts
import { describe, it, expect } from 'vitest';
import {
  recapPageReducer,
  createInitialRecapPageState,
  EMPTY_HANDLE_INPUTS,
  hasAnyConnection,
  type RecapPageState,
  type RecapConnectionStatus,
} from '@/lib/recap/page-state';
```

Then append these test blocks to the end of the file:

```ts
describe('hasAnyConnection', () => {
  it('is true when at least one platform is connected', () => {
    expect(hasAnyConnection({ tiktok: true, instagram: false })).toBe(true);
  });

  it('is false when no platform is connected', () => {
    expect(hasAnyConnection({ tiktok: false, instagram: false })).toBe(false);
  });
});

describe('recapPageReducer — connections', () => {
  const handles = EMPTY_HANDLE_INPUTS;

  it('BOOTSTRAPPED with a connection but no handles goes to readyToGenerate', () => {
    const next = recapPageReducer(
      { status: 'loading' },
      { type: 'BOOTSTRAPPED', handles, connections: { tiktok: true, instagram: false }, recapCardId: null }
    );
    expect(next).toEqual({ status: 'readyToGenerate', handles, connections: { tiktok: true, instagram: false } });
  });

  it('BOOTSTRAPPED with neither handles nor connections goes to noHandlesConnected', () => {
    const next = recapPageReducer(
      { status: 'loading' },
      { type: 'BOOTSTRAPPED', handles, connections: { tiktok: false, instagram: false }, recapCardId: null }
    );
    expect(next).toEqual({ status: 'noHandlesConnected', handles, connections: { tiktok: false, instagram: false }, error: null });
  });

  it('DISCONNECTED drops that platform from readyToGenerate to noHandlesConnected when nothing else is connected', () => {
    const state: RecapPageState = { status: 'readyToGenerate', handles, connections: { tiktok: true, instagram: false } };
    const next = recapPageReducer(state, { type: 'DISCONNECTED', platform: 'tiktok' });
    expect(next).toEqual({ status: 'noHandlesConnected', handles, connections: { tiktok: false, instagram: false }, error: null });
  });

  it('DISCONNECTED stays readyToGenerate when a handle is still saved for another platform', () => {
    const withHandle = { ...handles, youtube: 'creator' };
    const state: RecapPageState = { status: 'readyToGenerate', handles: withHandle, connections: { tiktok: true, instagram: false } };
    const next = recapPageReducer(state, { type: 'DISCONNECTED', platform: 'tiktok' });
    expect(next).toEqual({ status: 'readyToGenerate', handles: withHandle, connections: { tiktok: false, instagram: false } });
  });

  it('DISCONNECTED is ignored outside a handle-editing state', () => {
    const state: RecapPageState = { status: 'generating', handles, connections: { tiktok: true, instagram: false }, stillWorking: false };
    expect(recapPageReducer(state, { type: 'DISCONNECTED', platform: 'tiktok' })).toBe(state);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/recap/page-state.test.ts`
Expected: FAIL — `hasAnyConnection` doesn't exist, `BOOTSTRAPPED`/`DISCONNECTED` events don't carry/handle `connections` yet.

- [ ] **Step 3: Modify `lib/recap/page-state.ts`**

Replace the file's full contents with:

```ts
import { isValidEmailFormat } from '@/lib/auth/sign-in-flow-state';
import type { RecapPlatform } from './types';

export type RecapHandleInputs = Record<RecapPlatform, string>;

export const EMPTY_HANDLE_INPUTS: RecapHandleInputs = { youtube: '', tiktok: '', instagram: '' };

export interface RecapConnectionStatus {
  tiktok: boolean;
  instagram: boolean;
}

export const EMPTY_CONNECTIONS: RecapConnectionStatus = { tiktok: false, instagram: false };

export type RecapPageState =
  | { status: 'loading' }
  | { status: 'noHandlesConnected'; handles: RecapHandleInputs; connections: RecapConnectionStatus; error: string | null }
  | { status: 'readyToGenerate'; handles: RecapHandleInputs; connections: RecapConnectionStatus }
  | { status: 'generating'; handles: RecapHandleInputs; connections: RecapConnectionStatus; stillWorking: boolean }
  | { status: 'redirectingToCard'; recapCardId: string }
  | { status: 'generationFailed'; handles: RecapHandleInputs; connections: RecapConnectionStatus; error: string }
  // Sign-in sub-flow, mirroring lib/auth/sign-in-flow-state.ts so the same
  // <SignInPrompt> component drives it.
  | { status: 'needsSignIn'; email: string; notice: string | null }
  | { status: 'submittingMagicLink'; email: string }
  | { status: 'checkEmail'; email: string }
  | { status: 'magicLinkError'; email: string; error: string };

export type RecapPageEvent =
  | { type: 'BOOTSTRAPPED'; handles: RecapHandleInputs; connections: RecapConnectionStatus; recapCardId: string | null }
  | { type: 'BOOTSTRAP_FAILED' }
  | { type: 'BOOTSTRAP_UNAUTHORIZED' }
  | { type: 'HANDLE_CHANGED'; platform: RecapPlatform; value: string }
  | { type: 'HANDLES_SAVED' }
  | { type: 'HANDLES_SAVE_FAILED'; error: string }
  | { type: 'DISCONNECTED'; platform: 'tiktok' | 'instagram' }
  | { type: 'GENERATE' }
  | { type: 'GENERATE_STILL_WORKING' }
  | { type: 'GENERATE_SUCCESS'; recapCardId: string }
  | { type: 'GENERATE_FAILED'; error: string }
  | { type: 'EMAIL_CHANGED'; email: string }
  | { type: 'SUBMIT_EMAIL' }
  | { type: 'MAGIC_LINK_SENT' }
  | { type: 'MAGIC_LINK_FAILED'; error: string }
  | { type: 'RESEND_EMAIL' }
  | { type: 'RETRY_EMAIL' };

export function hasAnyHandle(handles: RecapHandleInputs): boolean {
  return Boolean(handles.youtube || handles.tiktok || handles.instagram);
}

export function hasAnyConnection(connections: RecapConnectionStatus): boolean {
  return connections.tiktok || connections.instagram;
}

function isReadyToGenerate(handles: RecapHandleInputs, connections: RecapConnectionStatus): boolean {
  return hasAnyHandle(handles) || hasAnyConnection(connections);
}

/**
 * The states in which the handle inputs are live: a creator can type into
 * them and save. Generation failing must not freeze the form — fixing a
 * typo or adding a platform is the most likely way out of that failure.
 */
export const HANDLE_EDITING_STATUSES = ['noHandlesConnected', 'readyToGenerate', 'generationFailed'] as const;

export type HandleEditingStatus = (typeof HANDLE_EDITING_STATUSES)[number];

export function isHandleEditingState(
  state: RecapPageState
): state is Extract<RecapPageState, { status: HandleEditingStatus }> {
  return (HANDLE_EDITING_STATUSES as readonly string[]).includes(state.status);
}

export function createInitialRecapPageState(): RecapPageState {
  return { status: 'loading' };
}

export function recapPageReducer(state: RecapPageState, event: RecapPageEvent): RecapPageState {
  switch (event.type) {
    case 'BOOTSTRAPPED':
      if (event.recapCardId) {
        return { status: 'redirectingToCard', recapCardId: event.recapCardId };
      }
      return isReadyToGenerate(event.handles, event.connections)
        ? { status: 'readyToGenerate', handles: event.handles, connections: event.connections }
        : { status: 'noHandlesConnected', handles: event.handles, connections: event.connections, error: null };

    case 'BOOTSTRAP_FAILED':
      return {
        status: 'noHandlesConnected',
        handles: EMPTY_HANDLE_INPUTS,
        connections: EMPTY_CONNECTIONS,
        error: "We couldn't load your recap settings. Please refresh and try again.",
      };

    case 'BOOTSTRAP_UNAUTHORIZED':
      return { status: 'needsSignIn', email: '', notice: null };

    case 'HANDLE_CHANGED':
      return isHandleEditingState(state)
        ? { ...state, handles: { ...state.handles, [event.platform]: event.value } }
        : state;

    case 'HANDLES_SAVED':
      if (!isHandleEditingState(state)) return state;
      // A save that clears every platform succeeds server-side but leaves
      // nothing to generate from — don't offer a Generate button that can
      // only 400.
      return isReadyToGenerate(state.handles, state.connections)
        ? { status: 'readyToGenerate', handles: state.handles, connections: state.connections }
        : { status: 'noHandlesConnected', handles: state.handles, connections: state.connections, error: null };

    case 'HANDLES_SAVE_FAILED':
      return isHandleEditingState(state)
        ? { status: 'noHandlesConnected', handles: state.handles, connections: state.connections, error: event.error }
        : state;

    case 'DISCONNECTED': {
      if (!isHandleEditingState(state)) return state;
      const connections = { ...state.connections, [event.platform]: false };
      return isReadyToGenerate(state.handles, connections)
        ? { status: 'readyToGenerate', handles: state.handles, connections }
        : { status: 'noHandlesConnected', handles: state.handles, connections, error: null };
    }

    case 'GENERATE':
      return state.status === 'readyToGenerate' || state.status === 'generationFailed'
        ? { status: 'generating', handles: state.handles, connections: state.connections, stillWorking: false }
        : state;

    case 'GENERATE_STILL_WORKING':
      return state.status === 'generating' ? { ...state, stillWorking: true } : state;

    case 'GENERATE_SUCCESS':
      return state.status === 'generating' ? { status: 'redirectingToCard', recapCardId: event.recapCardId } : state;

    case 'GENERATE_FAILED':
      return state.status === 'generating'
        ? { status: 'generationFailed', handles: state.handles, connections: state.connections, error: event.error }
        : state;

    case 'EMAIL_CHANGED':
      return state.status === 'needsSignIn' || state.status === 'magicLinkError'
        ? { ...state, email: event.email }
        : state;

    case 'SUBMIT_EMAIL':
      if (state.status !== 'needsSignIn' && state.status !== 'magicLinkError') return state;
      if (!isValidEmailFormat(state.email)) return state;
      return { status: 'submittingMagicLink', email: state.email };

    case 'MAGIC_LINK_SENT':
      return state.status === 'submittingMagicLink' ? { status: 'checkEmail', email: state.email } : state;

    case 'MAGIC_LINK_FAILED':
      return state.status === 'submittingMagicLink'
        ? { status: 'magicLinkError', email: state.email, error: event.error }
        : state;

    case 'RESEND_EMAIL':
      return state.status === 'checkEmail' ? { status: 'submittingMagicLink', email: state.email } : state;

    case 'RETRY_EMAIL':
      return state.status === 'checkEmail' ? { status: 'needsSignIn', email: state.email, notice: null } : state;

    default:
      return state;
  }
}
```

- [ ] **Step 4: Run the page-state test to verify it passes**

Run: `npx vitest run tests/unit/lib/recap/page-state.test.ts`
Expected: PASS

- [ ] **Step 5: Modify `app/recap/page.tsx`**

Replace the file's full contents with:

```tsx
'use client';

import { Suspense, useEffect, useReducer, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Spinner } from '@/components/Spinner';
import { SignInPrompt } from '@/components/SignInPrompt';
import {
  recapPageReducer,
  createInitialRecapPageState,
  isHandleEditingState,
  type RecapHandleInputs,
  type RecapConnectionStatus,
} from '@/lib/recap/page-state';
import type { RecapPlatform } from '@/lib/recap/types';

const PLATFORM_LABELS: Record<RecapPlatform, string> = {
  youtube: 'YouTube channel handle',
  tiktok: 'TikTok handle',
  instagram: 'Instagram handle',
};

const OAUTH_PLATFORM_NAMES: Record<'tiktok' | 'instagram', string> = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
};

function isOAuthPlatform(platform: RecapPlatform): platform is 'tiktok' | 'instagram' {
  return platform === 'tiktok' || platform === 'instagram';
}

function RecapPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // /recap?edit=1 is how a creator gets back to the handle form after a card
  // already exists for this month — without it the bootstrap redirect makes
  // /recap a dead end until the month rolls over.
  const editMode = searchParams.get('edit') === '1';
  const [state, dispatch] = useReducer(recapPageReducer, createInitialRecapPageState());
  const stillWorkingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Read once on first render — a full page navigation to the OAuth
  // provider and back is how connected=/oauthError= ever get here.
  const [toast] = useState<{ kind: 'success' | 'error'; message: string } | null>(() => {
    const connected = searchParams.get('connected');
    const oauthError = searchParams.get('oauthError');
    if (connected === 'tiktok' || connected === 'instagram') {
      return { kind: 'success', message: `${OAUTH_PLATFORM_NAMES[connected]} connected!` };
    }
    if (oauthError === 'denied') {
      return { kind: 'error', message: "You didn't grant access — no problem, your existing setup is unaffected." };
    }
    if (oauthError) {
      return { kind: 'error', message: 'Something went wrong connecting that platform. Please try again.' };
    }
    return null;
  });

  useEffect(() => {
    if (!toast) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete('connected');
    params.delete('oauthError');
    const query = params.toString();
    router.replace(query ? `/recap?${query}` : '/recap', { scroll: false });
    // Only ever run once per mount — re-running on every searchParams
    // change would immediately re-trigger from the replaced URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/recap')
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401) {
          dispatch({ type: 'BOOTSTRAP_UNAUTHORIZED' });
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        if (data.error) {
          dispatch({ type: 'BOOTSTRAP_FAILED' });
          return;
        }
        const handles: RecapHandleInputs = {
          youtube: data.handles.youtube ?? '',
          tiktok: data.handles.tiktok ?? '',
          instagram: data.handles.instagram ?? '',
        };
        const connections: RecapConnectionStatus = {
          tiktok: Boolean(data.connections?.tiktok),
          instagram: Boolean(data.connections?.instagram),
        };
        dispatch({ type: 'BOOTSTRAPPED', handles, connections, recapCardId: editMode ? null : data.recapCardId });
      })
      .catch(() => {
        if (!cancelled) dispatch({ type: 'BOOTSTRAP_FAILED' });
      });
    return () => {
      cancelled = true;
    };
  }, [editMode]);

  useEffect(() => {
    if (state.status === 'redirectingToCard') {
      router.push(`/recap/${state.recapCardId}`);
    }
  }, [state, router]);

  useEffect(() => {
    if (state.status !== 'generating') return undefined;
    stillWorkingTimer.current = setTimeout(() => dispatch({ type: 'GENERATE_STILL_WORKING' }), 8000);
    return () => {
      if (stillWorkingTimer.current) clearTimeout(stillWorkingTimer.current);
    };
  }, [state.status]);

  async function saveHandles() {
    if (!isHandleEditingState(state)) return;
    try {
      const res = await fetch('/api/recap/handles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state.handles),
      });
      const data = await res.json();
      if (!res.ok) {
        dispatch({ type: 'HANDLES_SAVE_FAILED', error: data.error ?? 'Something went wrong saving your handles.' });
        return;
      }
      dispatch({ type: 'HANDLES_SAVED' });
    } catch {
      dispatch({
        type: 'HANDLES_SAVE_FAILED',
        error: "We couldn't reach the server. Check your connection and try again.",
      });
    }
  }

  async function disconnect(platform: 'tiktok' | 'instagram') {
    const res = await fetch(`/api/oauth/${platform}/disconnect`, { method: 'POST' }).catch(() => null);
    if (res?.ok) {
      dispatch({ type: 'DISCONNECTED', platform });
    }
  }

  async function generate() {
    dispatch({ type: 'GENERATE' });
    try {
      const res = await fetch('/api/recap', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        dispatch({ type: 'GENERATE_FAILED', error: data.error ?? 'Something went wrong generating your recap card.' });
        return;
      }
      dispatch({ type: 'GENERATE_SUCCESS', recapCardId: data.recapCard.id });
    } catch {
      dispatch({ type: 'GENERATE_FAILED', error: "We couldn't reach the server. Check your connection and try again." });
    }
  }

  async function submitMagicLink(email: string) {
    try {
      const response = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, redirectPath: '/recap' }),
      });
      const data = await response.json();
      if (!response.ok) {
        dispatch({ type: 'MAGIC_LINK_FAILED', error: data.error ?? 'Something went wrong. Please try again.' });
        return;
      }
      dispatch({ type: 'MAGIC_LINK_SENT' });
    } catch {
      dispatch({ type: 'MAGIC_LINK_FAILED', error: "We couldn't reach the server. Check your connection and try again." });
    }
  }

  if (state.status === 'loading' || state.status === 'redirectingToCard') {
    return <p>Loading…</p>;
  }

  if (
    state.status === 'needsSignIn' ||
    state.status === 'submittingMagicLink' ||
    state.status === 'checkEmail' ||
    state.status === 'magicLinkError'
  ) {
    return (
      <main className="mx-auto flex max-w-md flex-col gap-6 px-6 py-16">
        <h1 className="text-2xl font-bold text-gray-900">Monthly recap card</h1>
        <SignInPrompt
          state={state}
          introCopy="Sign in with a one-time email link to set up your recap card."
          returnCopy="Click it to continue and we'll bring you right back here."
          onEmailChange={(email) => dispatch({ type: 'EMAIL_CHANGED', email })}
          onSubmitEmail={() => {
            const { email } = state;
            dispatch({ type: 'SUBMIT_EMAIL' });
            void submitMagicLink(email);
          }}
          onResend={() => {
            const { email } = state;
            dispatch({ type: 'RESEND_EMAIL' });
            void submitMagicLink(email);
          }}
          onRetryEmail={() => dispatch({ type: 'RETRY_EMAIL' })}
        />
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-6 py-16">
      <h1 className="text-2xl font-bold text-gray-900">Monthly recap card</h1>
      <p className="text-gray-600">Connect your platforms once, then generate a shareable card of this month&apos;s stats.</p>

      {toast && (
        <p role="alert" className={toast.kind === 'success' ? 'text-sm text-green-700' : 'text-sm text-red-600'}>
          {toast.message}
        </p>
      )}

      <div className="flex flex-col gap-3">
        {(['youtube', 'tiktok', 'instagram'] as const).map((platform) => {
          const connected = isOAuthPlatform(platform) && state.connections[platform];

          if (connected && isOAuthPlatform(platform)) {
            return (
              <div key={platform} className="flex flex-col gap-1 text-sm font-medium text-gray-700">
                {PLATFORM_LABELS[platform]}
                <div className="flex items-center justify-between gap-2 rounded-lg border border-gray-300 px-4 py-2 font-normal">
                  <span>Connected via {OAUTH_PLATFORM_NAMES[platform]} ✓</span>
                  <button type="button" onClick={() => disconnect(platform)} className="text-indigo-700 underline">
                    Disconnect
                  </button>
                </div>
              </div>
            );
          }

          return (
            <label key={platform} className="flex flex-col gap-1 text-sm font-medium text-gray-700">
              {PLATFORM_LABELS[platform]}
              <input
                type="text"
                value={state.handles[platform]}
                onChange={(e) => dispatch({ type: 'HANDLE_CHANGED', platform, value: e.target.value })}
                placeholder="@handle or profile URL"
                // Generation is the one state where the form legitimately can't
                // accept edits — say so rather than silently swallowing them.
                disabled={state.status === 'generating'}
                className="rounded-lg border border-gray-300 px-4 py-2 font-normal disabled:bg-gray-50"
              />
              {isOAuthPlatform(platform) && (
                <a href={`/api/oauth/${platform}/authorize`} className="self-start text-xs text-indigo-700 underline">
                  Or connect via {OAUTH_PLATFORM_NAMES[platform]}
                </a>
              )}
            </label>
          );
        })}
        <button
          type="button"
          onClick={saveHandles}
          disabled={state.status === 'generating'}
          className="self-start rounded-full border border-indigo-600 px-4 py-2 text-sm font-semibold text-indigo-700 disabled:opacity-50"
        >
          Save platforms
        </button>
      </div>

      {state.status === 'noHandlesConnected' && state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}

      {state.status === 'readyToGenerate' && (
        <button
          type="button"
          onClick={generate}
          className="rounded-full bg-indigo-600 px-6 py-3 font-semibold text-white hover:bg-indigo-700"
        >
          Generate this month&apos;s recap
        </button>
      )}

      {state.status === 'generating' && (
        <Spinner label={state.stillWorking ? 'Still working — pulling your posts from each platform…' : 'Generating…'} />
      )}

      {state.status === 'generationFailed' && (
        <div className="flex flex-col gap-2">
          <p role="alert" className="text-sm text-red-600">
            {state.error}
          </p>
          <button
            type="button"
            onClick={generate}
            className="self-start rounded-full bg-indigo-600 px-6 py-3 font-semibold text-white hover:bg-indigo-700"
          >
            Try again
          </button>
        </div>
      )}
    </main>
  );
}

export default function RecapPage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <RecapPageInner />
    </Suspense>
  );
}
```

- [ ] **Step 6: Run the full unit suite and typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: PASS, no type errors

- [ ] **Step 7: Commit**

```bash
git add lib/recap/page-state.ts app/recap/page.tsx tests/unit/lib/recap/page-state.test.ts
git commit -m "feat: add connect/disconnect UI and connection-aware gating to /recap"
```

---

### Task 12: Playwright E2E smoke test

**Files:**
- Create: `tests/e2e/oauth-connect-smoke.spec.ts`

**Interfaces:**
- Consumes: `/recap` (Task 11) and `/api/recap`, `/api/oauth/[platform]/disconnect` (Tasks 8, 10), all via mocked network responses
- Produces: nothing consumed by later tasks — terminal verification for this plan

- [ ] **Step 1: Write the test**

```ts
// tests/e2e/oauth-connect-smoke.spec.ts
import { test, expect } from '@playwright/test';

test('a connected TikTok platform shows as connected on /recap and can be disconnected', async ({ page }) => {
  let tiktokConnected = true;

  await page.route('**/api/recap', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        handles: { youtube: null, tiktok: null, instagram: null },
        connections: { tiktok: tiktokConnected, instagram: false },
        recapCardId: null,
      }),
    });
  });

  await page.route('**/api/oauth/tiktok/disconnect', async (route) => {
    tiktokConnected = false;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  await page.goto('/recap');
  await expect(page.getByText(/connected via tiktok/i)).toBeVisible();
  await expect(page.getByRole('link', { name: /connect via instagram/i })).toBeVisible();

  await page.getByRole('button', { name: /disconnect/i }).click();
  await expect(page.getByRole('link', { name: /connect via tiktok/i })).toBeVisible();
});

test('landing on /recap with a connected= query param shows a one-time success toast', async ({ page }) => {
  await page.route('**/api/recap', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        handles: { youtube: null, tiktok: null, instagram: null },
        connections: { tiktok: true, instagram: false },
        recapCardId: null,
      }),
    });
  });

  await page.goto('/recap?connected=tiktok');
  await expect(page.getByRole('alert').filter({ hasText: /tiktok connected/i })).toBeVisible();
  await expect(page).toHaveURL('/recap');
});
```

- [ ] **Step 2: Run the test**

Run: `npx playwright test tests/e2e/oauth-connect-smoke.spec.ts`
Expected: PASS — 2 tests passed.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/oauth-connect-smoke.spec.ts
git commit -m "test: add Playwright smoke test for OAuth connect/disconnect on /recap"
```

---

## Verification

After all tasks are complete, run the full suite before considering this plan done:

```bash
npm run typecheck
npm run lint
npx vitest run
npx playwright test
npm run build
```

All five must pass with no errors before this branch is considered mergeable. Additionally:

- Confirm every "⚠️ Live-doc check" note in Tasks 3 and 4 has actually been verified against TikTok's and Instagram's current developer documentation before this ships to real users — this plan's code is written from the platforms' documented shape as of the plan's writing, not guaranteed current at implementation time.
- Confirm `OAUTH_TOKEN_ENCRYPTION_KEY`, `TIKTOK_CLIENT_ID`/`TIKTOK_CLIENT_SECRET`, and `INSTAGRAM_CLIENT_ID`/`INSTAGRAM_CLIENT_SECRET` are documented in `.env.example` (Task 8) and set on the deployment target before this feature is exercised against real accounts — none of this plan's code will work against a real provider without them.
