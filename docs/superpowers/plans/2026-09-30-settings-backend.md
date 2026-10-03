# Settings Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Settings page's preview sections real — profile persistence, a subscription-independent connected-platforms endpoint, timezone/locale persistence (applied to real date formatting), native Supabase MFA two-factor auth layered on magic-link sign-in, notification preferences with real sends where a trigger exists, and soft-delete account deletion with a 14-day grace period.

**Architecture:** Every new route follows this codebase's existing shape exactly: `app/api/settings/**/route.ts` files are thin wiring (auth check, real Supabase/Stripe/Resend calls), delegating to pure, injected-dependency handler functions in `lib/settings/*.ts` that carry all the actual logic and all the tests — the same split already used by `lib/billing/checkout-handler.ts` + `app/api/billing/checkout/route.ts`. No new validation library. New tables/columns are timestamped migrations matching the existing `profiles`/`subscriptions`/`platform_connections` style. Two-factor auth needs no new table (Supabase Auth owns factor state) but does change `lib/auth/callback.ts`, the one place a magic link currently completes sign-in.

**Tech Stack:** TypeScript, Next.js API routes, Supabase (Postgres + migrations + Auth MFA), Stripe (subscription cancellation), Resend (transactional email), Vitest, React Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-30-settings-backend-design.md`

## Global Constraints

- No password-based auth. "Change password" is removed from the UI, not built (spec decision 2).
- 2FA is real TOTP via Supabase's native `supabase.auth.mfa.*` API, layered on top of magic-link — no password involved (spec decision 3).
- No multi-device session list and no "sign out everywhere" — Settings' Sessions area keeps exactly today's single real "Sign out" button (spec decision 4).
- The new platform-connections read endpoint must **never** call `hasActiveSubscription` — that was the entire bug being fixed (spec decision 5).
- "Weekly recap ready" and "Diagnostic finished" notification toggles persist but get **no** real send wired in this plan — there is no async event to trigger them (spec decision 6, §6).
- Timezone is applied to real date formatting (Billing renewal date, Home recap month); locale is stored only, no UI translation (spec decision 7).
- Account deletion: soft delete, 14-day grace period, cancel any active Stripe subscription immediately on request, auto-cancel the pending deletion on next successful sign-in (spec decision 8).
- Every new route: `401` via `supabase.auth.getUser()` first, matching every existing route in `app/api/`. Privileged reads/writes go through `createSupabaseServiceRoleClient()`.
- Sensitive actions (MFA verify, account deletion) are rate-limited via the existing `checkAndRecordRateLimit` (`lib/rate-limit.ts`), profile-scoped — no new rate-limit primitive.

---

### Task 1: Profile display-name persistence

**Files:**
- Create: `lib/settings/profile-handler.ts`
- Create: `app/api/settings/profile/route.ts`
- Modify: `app/settings/page.tsx`
- Test: `tests/unit/lib/settings/profile-handler.test.ts`
- Test: `tests/unit/app/settings/page.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks. `profiles.display_name` already exists (`20260812000001_create_profiles.sql`) — no migration needed.
- Produces: `handleUpdateProfile(deps, context): Promise<UpdateProfileResult>`, `PATCH /api/settings/profile`, consumed only by this task's own frontend wiring.

- [ ] **Step 1: Write the failing handler tests**

Create `tests/unit/lib/settings/profile-handler.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { handleUpdateProfile, type UpdateProfileDeps } from '@/lib/settings/profile-handler';

function makeDeps(overrides: Partial<UpdateProfileDeps> = {}): UpdateProfileDeps {
  return {
    saveDisplayName: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('handleUpdateProfile', () => {
  it('returns 401 when not signed in', async () => {
    const result = await handleUpdateProfile(makeDeps(), { profileId: null, displayName: 'Creator' });
    expect(result.status).toBe(401);
  });

  it('returns 400 for an empty display name', async () => {
    const result = await handleUpdateProfile(makeDeps(), { profileId: 'profile-1', displayName: '   ' });
    expect(result.status).toBe(400);
  });

  it('returns 400 for a display name over 60 characters', async () => {
    const result = await handleUpdateProfile(makeDeps(), { profileId: 'profile-1', displayName: 'a'.repeat(61) });
    expect(result.status).toBe(400);
  });

  it('trims and saves a valid display name', async () => {
    const saveDisplayName = vi.fn().mockResolvedValue(undefined);
    const result = await handleUpdateProfile(makeDeps({ saveDisplayName }), {
      profileId: 'profile-1',
      displayName: '  Jordan  ',
    });
    expect(result.status).toBe(200);
    expect(saveDisplayName).toHaveBeenCalledWith('profile-1', 'Jordan');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/lib/settings/profile-handler.test.ts`
Expected: FAIL with `Cannot find module '@/lib/settings/profile-handler'`

- [ ] **Step 3: Implement the handler**

Create `lib/settings/profile-handler.ts`:

```ts
export interface UpdateProfileDeps {
  saveDisplayName: (profileId: string, displayName: string) => Promise<void>;
}

export interface UpdateProfileContext {
  profileId: string | null;
  displayName: string;
}

export interface UpdateProfileResult {
  status: number;
  body: Record<string, unknown>;
}

const MAX_DISPLAY_NAME_LENGTH = 60;

export async function handleUpdateProfile(
  deps: UpdateProfileDeps,
  context: UpdateProfileContext
): Promise<UpdateProfileResult> {
  if (!context.profileId) {
    return { status: 401, body: { error: 'You must be signed in.' } };
  }

  const trimmed = context.displayName.trim();
  if (trimmed.length === 0) {
    return { status: 400, body: { error: 'Display name cannot be empty.' } };
  }
  if (trimmed.length > MAX_DISPLAY_NAME_LENGTH) {
    return { status: 400, body: { error: `Display name must be ${MAX_DISPLAY_NAME_LENGTH} characters or fewer.` } };
  }

  await deps.saveDisplayName(context.profileId, trimmed);
  return { status: 200, body: { ok: true } };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/lib/settings/profile-handler.test.ts`
Expected: PASS

- [ ] **Step 5: Create the route**

Create `app/api/settings/profile/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { handleUpdateProfile } from '@/lib/settings/profile-handler';

export async function PATCH(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const serviceClient = createSupabaseServiceRoleClient();
  const body = await request.json().catch(() => ({}));

  const result = await handleUpdateProfile(
    {
      saveDisplayName: async (profileId, displayName) => {
        const { error } = await serviceClient.from('profiles').update({ display_name: displayName }).eq('id', profileId);
        if (error) {
          throw new Error(`Failed to save display name: ${error.message}`);
        }
      },
    },
    { profileId: user?.id ?? null, displayName: typeof body.displayName === 'string' ? body.displayName : '' }
  );

  return NextResponse.json(result.body, { status: result.status });
}
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 7: Wire the frontend and write its test**

In `app/settings/page.tsx`, add a `savedDisplayName` toast state and wire the Profile section's "Display name" input to save on blur. Add near the other `useState` declarations:

```ts
const [displayNameSaved, setDisplayNameSaved] = useState(false);
```

Replace the display-name `<input>`'s `onChange` handler block with:

```tsx
<input
  type="text"
  value={displayName}
  onChange={(e) => setDisplayName(e.target.value)}
  onBlur={async () => {
    if (!displayName.trim()) return;
    const res = await fetch('/api/settings/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName }),
    });
    if (res.ok) {
      setDisplayNameSaved(true);
      setTimeout(() => setDisplayNameSaved(false), 1700);
    }
  }}
  maxLength={60}
  className="rounded-[10px] border border-[#d8d8e0] px-[14px] py-[10px] font-normal text-gray-900"
/>
{displayNameSaved && <span className="text-xs text-[#047857]">Saved</span>}
```

Add to `tests/unit/app/settings/page.test.tsx`, inside the existing `describe('SettingsPage', ...)` block:

```ts
it('saves the display name on blur', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({ status: 200, json: async () => ({ email: 'creator@example.com' }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
  vi.stubGlobal('fetch', fetchMock);

  render(<SettingsPage />);
  const input = await screen.findByLabelText('Display name');
  fireEvent.change(input, { target: { value: 'Jordan' } });
  fireEvent.blur(input);

  await waitFor(() =>
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/settings/profile',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ displayName: 'Jordan' }) })
    )
  );
  expect(await screen.findByText('Saved')).toBeInTheDocument();
});
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx vitest run tests/unit/app/settings/page.test.tsx`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add lib/settings/profile-handler.ts app/api/settings/profile/route.ts app/settings/page.tsx tests/unit/lib/settings/profile-handler.test.ts tests/unit/app/settings/page.test.tsx
git commit -m "feat(settings): persist profile display name"
```

---

### Task 2: Email-change confirmation flow

**Files:**
- Create: `lib/settings/email-handler.ts`
- Create: `app/api/settings/email/route.ts`
- Modify: `app/settings/page.tsx`
- Test: `tests/unit/lib/settings/email-handler.test.ts`
- Test: `tests/unit/app/settings/page.test.tsx`

**Interfaces:**
- Consumes: `isValidEmailFormat` from `lib/auth/sign-in-flow-state.ts` (existing).
- Produces: `handleChangeEmail(deps, context): Promise<ChangeEmailResult>`, `POST /api/settings/email`.

- [ ] **Step 1: Write the failing handler tests**

Create `tests/unit/lib/settings/email-handler.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { handleChangeEmail, type ChangeEmailDeps } from '@/lib/settings/email-handler';

function makeDeps(overrides: Partial<ChangeEmailDeps> = {}): ChangeEmailDeps {
  return {
    updateEmail: vi.fn().mockResolvedValue({ error: null }),
    ...overrides,
  };
}

describe('handleChangeEmail', () => {
  it('returns 401 when not signed in', async () => {
    const result = await handleChangeEmail(makeDeps(), { profileId: null, email: 'new@example.com' });
    expect(result.status).toBe(401);
  });

  it('returns 400 for an invalid email format', async () => {
    const result = await handleChangeEmail(makeDeps(), { profileId: 'profile-1', email: 'not-an-email' });
    expect(result.status).toBe(400);
  });

  it('calls updateEmail with the trimmed address and returns confirmationSent', async () => {
    const updateEmail = vi.fn().mockResolvedValue({ error: null });
    const result = await handleChangeEmail(makeDeps({ updateEmail }), {
      profileId: 'profile-1',
      email: ' new@example.com ',
    });
    expect(updateEmail).toHaveBeenCalledWith('new@example.com');
    expect(result.status).toBe(200);
    expect(result.body.status).toBe('confirmationSent');
  });

  it('surfaces the Supabase error message when updateEmail fails', async () => {
    const deps = makeDeps({ updateEmail: vi.fn().mockResolvedValue({ error: { message: 'Email already in use.' } }) });
    const result = await handleChangeEmail(deps, { profileId: 'profile-1', email: 'new@example.com' });
    expect(result.status).toBe(400);
    expect(result.body.error).toBe('Email already in use.');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/lib/settings/email-handler.test.ts`
Expected: FAIL with `Cannot find module '@/lib/settings/email-handler'`

- [ ] **Step 3: Implement the handler**

Create `lib/settings/email-handler.ts`:

```ts
import { isValidEmailFormat } from '@/lib/auth/sign-in-flow-state';

export interface ChangeEmailDeps {
  updateEmail: (email: string) => Promise<{ error: { message: string } | null }>;
}

export interface ChangeEmailContext {
  profileId: string | null;
  email: string;
}

export interface ChangeEmailResult {
  status: number;
  body: Record<string, unknown>;
}

export async function handleChangeEmail(deps: ChangeEmailDeps, context: ChangeEmailContext): Promise<ChangeEmailResult> {
  if (!context.profileId) {
    return { status: 401, body: { error: 'You must be signed in.' } };
  }

  const email = context.email.trim();
  if (!isValidEmailFormat(email)) {
    return { status: 400, body: { error: "That doesn't look like a valid email address." } };
  }

  const { error } = await deps.updateEmail(email);
  if (error) {
    return { status: 400, body: { error: error.message } };
  }

  return { status: 200, body: { status: 'confirmationSent' } };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/lib/settings/email-handler.test.ts`
Expected: PASS

- [ ] **Step 5: Create the route**

Create `app/api/settings/email/route.ts`. This must call `updateUser` on the **user's own session client**, not the service-role client — an email change is an auth-identity operation, not a data write, and Supabase's `updateUser` acts on whichever client made the call:

```ts
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { handleChangeEmail } from '@/lib/settings/email-handler';

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const body = await request.json().catch(() => ({}));

  const result = await handleChangeEmail(
    {
      updateEmail: (email) => supabase.auth.updateUser({ email }),
    },
    { profileId: user?.id ?? null, email: typeof body.email === 'string' ? body.email : '' }
  );

  return NextResponse.json(result.body, { status: result.status });
}
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 7: Wire the frontend and write its test**

In `app/settings/page.tsx`, add state for the confirmation message and replace the Email field's save behavior. Add near the other `useState` declarations:

```ts
const [emailConfirmationSent, setEmailConfirmationSent] = useState(false);
const [emailError, setEmailError] = useState<string | null>(null);
```

Replace the email `<label>` block:

```tsx
<label className="flex flex-col gap-1.5 text-[13px] font-semibold text-gray-700">
  Email
  <input
    type="email"
    value={email}
    onChange={(e) => {
      setEmail(e.target.value);
      setEmailConfirmationSent(false);
      setEmailError(null);
    }}
    onBlur={async () => {
      if (!email.trim()) return;
      const res = await fetch('/api/settings/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setEmailError(data.error ?? 'Something went wrong.');
        return;
      }
      setEmailConfirmationSent(true);
    }}
    className="rounded-[10px] border border-[#d8d8e0] px-[14px] py-[10px] font-normal text-gray-900"
  />
  {emailConfirmationSent && (
    <span className="text-xs text-[#047857]">Check your new inbox to confirm the change.</span>
  )}
  {emailError && (
    <span role="alert" className="text-xs text-[#b91c1c]">
      {emailError}
    </span>
  )}
</label>
```

Add to `tests/unit/app/settings/page.test.tsx`:

```ts
it('shows a confirmation message after changing the email', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({ status: 200, json: async () => ({ email: 'creator@example.com' }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'confirmationSent' }) });
  vi.stubGlobal('fetch', fetchMock);

  render(<SettingsPage />);
  const input = await screen.findByLabelText(/^email$/i);
  fireEvent.change(input, { target: { value: 'new@example.com' } });
  fireEvent.blur(input);

  expect(await screen.findByText(/check your new inbox/i)).toBeInTheDocument();
  expect(fetchMock).toHaveBeenLastCalledWith(
    '/api/settings/email',
    expect.objectContaining({ method: 'POST', body: JSON.stringify({ email: 'new@example.com' }) })
  );
});
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx vitest run tests/unit/app/settings/page.test.tsx`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add lib/settings/email-handler.ts app/api/settings/email/route.ts app/settings/page.tsx tests/unit/lib/settings/email-handler.test.ts tests/unit/app/settings/page.test.tsx
git commit -m "feat(settings): add email-change confirmation flow"
```

---

### Task 3: Connected-platforms read endpoint (the bug fix)

**Files:**
- Create: `lib/settings/platforms-handler.ts`
- Create: `app/api/settings/platforms/route.ts`
- Create: `app/api/settings/platforms/youtube/route.ts`
- Test: `tests/unit/lib/settings/platforms-handler.test.ts`

**Interfaces:**
- Consumes: nothing new — reads the existing `platform_connections` table and `profiles.youtube_channel_handle`.
- Produces: `handleGetPlatforms(deps, context)`, `handleUpdateYoutubeHandle(deps, context)`, `GET /api/settings/platforms`, `PATCH /api/settings/platforms/youtube`, consumed by Task 4's frontend.

- [ ] **Step 1: Write the failing handler tests**

Create `tests/unit/lib/settings/platforms-handler.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import {
  handleGetPlatforms,
  handleUpdateYoutubeHandle,
  type GetPlatformsDeps,
  type UpdateYoutubeHandleDeps,
} from '@/lib/settings/platforms-handler';

describe('handleGetPlatforms', () => {
  it('returns 401 when not signed in', async () => {
    const result = await handleGetPlatforms(
      { getConnectedPlatforms: vi.fn(), getYoutubeHandle: vi.fn() },
      { profileId: null }
    );
    expect(result.status).toBe(401);
  });

  it('reports connected status per platform without checking any subscription', async () => {
    const getConnectedPlatforms = vi.fn().mockResolvedValue(['tiktok']);
    const getYoutubeHandle = vi.fn().mockResolvedValue('@creator');
    const deps: GetPlatformsDeps = { getConnectedPlatforms, getYoutubeHandle };

    const result = await handleGetPlatforms(deps, { profileId: 'profile-1' });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ tiktok: true, instagram: false, youtube: true });
    expect(getConnectedPlatforms).toHaveBeenCalledWith('profile-1');
  });

  it('reports youtube as not connected when no handle is set', async () => {
    const deps: GetPlatformsDeps = {
      getConnectedPlatforms: vi.fn().mockResolvedValue([]),
      getYoutubeHandle: vi.fn().mockResolvedValue(null),
    };
    const result = await handleGetPlatforms(deps, { profileId: 'profile-1' });
    expect(result.body).toEqual({ tiktok: false, instagram: false, youtube: false });
  });
});

describe('handleUpdateYoutubeHandle', () => {
  it('returns 401 when not signed in', async () => {
    const result = await handleUpdateYoutubeHandle({ saveYoutubeHandle: vi.fn() }, { profileId: null, handle: '@x' });
    expect(result.status).toBe(401);
  });

  it('saves a trimmed handle', async () => {
    const saveYoutubeHandle = vi.fn().mockResolvedValue(undefined);
    const deps: UpdateYoutubeHandleDeps = { saveYoutubeHandle };
    const result = await handleUpdateYoutubeHandle(deps, { profileId: 'profile-1', handle: '  @creator  ' });
    expect(result.status).toBe(200);
    expect(saveYoutubeHandle).toHaveBeenCalledWith('profile-1', '@creator');
  });

  it('saves null to disconnect', async () => {
    const saveYoutubeHandle = vi.fn().mockResolvedValue(undefined);
    const result = await handleUpdateYoutubeHandle({ saveYoutubeHandle }, { profileId: 'profile-1', handle: null });
    expect(result.status).toBe(200);
    expect(saveYoutubeHandle).toHaveBeenCalledWith('profile-1', null);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/lib/settings/platforms-handler.test.ts`
Expected: FAIL with `Cannot find module '@/lib/settings/platforms-handler'`

- [ ] **Step 3: Implement the handlers**

Create `lib/settings/platforms-handler.ts`:

```ts
export interface GetPlatformsDeps {
  getConnectedPlatforms: (profileId: string) => Promise<Array<'tiktok' | 'instagram'>>;
  getYoutubeHandle: (profileId: string) => Promise<string | null>;
}

export interface GetPlatformsContext {
  profileId: string | null;
}

export interface GetPlatformsResult {
  status: number;
  body: Record<string, unknown>;
}

// Deliberately does NOT call hasActiveSubscription anywhere in this file —
// that was the whole bug this endpoint exists to fix. See design spec §5:
// GET /api/recap gates on subscription for its own feature; this endpoint
// answers a different question ("is my platform connected") that every
// signed-in user, free or paid, is entitled to see about their own account.
export async function handleGetPlatforms(deps: GetPlatformsDeps, context: GetPlatformsContext): Promise<GetPlatformsResult> {
  if (!context.profileId) {
    return { status: 401, body: { error: 'You must be signed in.' } };
  }

  const [connected, youtubeHandle] = await Promise.all([
    deps.getConnectedPlatforms(context.profileId),
    deps.getYoutubeHandle(context.profileId),
  ]);

  return {
    status: 200,
    body: {
      tiktok: connected.includes('tiktok'),
      instagram: connected.includes('instagram'),
      youtube: Boolean(youtubeHandle),
    },
  };
}

export interface UpdateYoutubeHandleDeps {
  saveYoutubeHandle: (profileId: string, handle: string | null) => Promise<void>;
}

export interface UpdateYoutubeHandleContext {
  profileId: string | null;
  handle: string | null;
}

export interface UpdateYoutubeHandleResult {
  status: number;
  body: Record<string, unknown>;
}

export async function handleUpdateYoutubeHandle(
  deps: UpdateYoutubeHandleDeps,
  context: UpdateYoutubeHandleContext
): Promise<UpdateYoutubeHandleResult> {
  if (!context.profileId) {
    return { status: 401, body: { error: 'You must be signed in.' } };
  }

  const trimmed = context.handle && context.handle.trim().length > 0 ? context.handle.trim() : null;
  await deps.saveYoutubeHandle(context.profileId, trimmed);
  return { status: 200, body: { ok: true } };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/lib/settings/platforms-handler.test.ts`
Expected: PASS

- [ ] **Step 5: Create the routes**

Create `app/api/settings/platforms/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { handleGetPlatforms } from '@/lib/settings/platforms-handler';

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const serviceClient = createSupabaseServiceRoleClient();

  const result = await handleGetPlatforms(
    {
      // Exact same lightweight existence check /api/recap already runs before
      // its own subscription gate — no decryption, no token refresh, no side
      // effects. See design spec §3.
      getConnectedPlatforms: async (profileId) => {
        const { data } = await serviceClient.from('platform_connections').select('platform').eq('profile_id', profileId);
        return (data ?? []).map((row) => row.platform as 'tiktok' | 'instagram');
      },
      getYoutubeHandle: async (profileId) => {
        const { data } = await serviceClient.from('profiles').select('youtube_channel_handle').eq('id', profileId).single();
        return data?.youtube_channel_handle ?? null;
      },
    },
    { profileId: user?.id ?? null }
  );

  return NextResponse.json(result.body, { status: result.status });
}
```

Create `app/api/settings/platforms/youtube/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { handleUpdateYoutubeHandle } from '@/lib/settings/platforms-handler';

export async function PATCH(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const serviceClient = createSupabaseServiceRoleClient();
  const body = await request.json().catch(() => ({}));

  const result = await handleUpdateYoutubeHandle(
    {
      saveYoutubeHandle: async (profileId, handle) => {
        const { error } = await serviceClient.from('profiles').update({ youtube_channel_handle: handle }).eq('id', profileId);
        if (error) {
          throw new Error(`Failed to save YouTube handle: ${error.message}`);
        }
      },
    },
    { profileId: user?.id ?? null, handle: typeof body.handle === 'string' || body.handle === null ? body.handle : null }
  );

  return NextResponse.json(result.body, { status: result.status });
}
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add lib/settings/platforms-handler.ts "app/api/settings/platforms/route.ts" "app/api/settings/platforms/youtube/route.ts" tests/unit/lib/settings/platforms-handler.test.ts
git commit -m "feat(settings): add subscription-independent platform-connections endpoint"
```

---

### Task 4: Wire real platform connect/disconnect into Settings

**Files:**
- Modify: `app/settings/page.tsx`
- Test: `tests/unit/app/settings/page.test.tsx`

**Interfaces:**
- Consumes: `GET /api/settings/platforms`, `PATCH /api/settings/platforms/youtube` (Task 3), the already-existing real `app/api/oauth/[platform]/authorize` and `POST app/api/oauth/[platform]/disconnect`.
- Produces: nothing further downstream.

This task replaces `app/settings/page.tsx`'s local-only `platformConnected` `useState` with real data and real actions. It also removes the Platforms line from the top "Preview" banner, since this section stops being a preview.

- [ ] **Step 1: Write the failing tests**

Replace the existing `it('toggles a platform connection locally', ...)` test in `tests/unit/app/settings/page.test.tsx` with:

```ts
it('loads real connection status and disconnects a connected platform for real', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({ status: 200, json: async () => ({ email: 'creator@example.com' }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ tiktok: true, instagram: false, youtube: false }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
  vi.stubGlobal('fetch', fetchMock);

  render(<SettingsPage />);
  await waitFor(() => expect(screen.getByText('Connected')).toBeInTheDocument());

  fireEvent.click(screen.getByRole('button', { name: /^disconnect$/i }));

  await waitFor(() =>
    expect(fetchMock).toHaveBeenLastCalledWith('/api/oauth/tiktok/disconnect', { method: 'POST' })
  );
  expect(await screen.findByText('Not connected')).toBeInTheDocument();
});

it('links Connect to the real OAuth authorize endpoint', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => {
      if (url === '/api/session') return Promise.resolve({ status: 200, json: async () => ({ email: 'creator@example.com' }) });
      return Promise.resolve({ ok: true, json: async () => ({ tiktok: false, instagram: false, youtube: false }) });
    })
  );

  render(<SettingsPage />);
  await waitFor(() => expect(screen.getAllByText('Not connected').length).toBeGreaterThan(0));

  const connectLinks = screen.getAllByRole('link', { name: /^connect$/i });
  expect(connectLinks[0]).toHaveAttribute('href', expect.stringMatching(/^\/api\/oauth\/(tiktok|instagram)\/authorize$/));
});

it('saves a YouTube handle', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({ status: 200, json: async () => ({ email: 'creator@example.com' }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ tiktok: false, instagram: false, youtube: false }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
  vi.stubGlobal('fetch', fetchMock);

  render(<SettingsPage />);
  const input = await screen.findByLabelText(/youtube handle/i);
  fireEvent.change(input, { target: { value: '@creator' } });
  fireEvent.blur(input);

  await waitFor(() =>
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/settings/platforms/youtube',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ handle: '@creator' }) })
    )
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/app/settings/page.test.tsx`
Expected: FAIL — the page still uses local-only `useState` for platform status, and there's no YouTube handle input yet.

- [ ] **Step 3: Implement**

In `app/settings/page.tsx`, remove the `platformConnected` `useState` and replace with real state fetched alongside session bootstrap. Add near the other `useState` declarations:

```ts
const [platforms, setPlatforms] = useState<{ tiktok: boolean; instagram: boolean; youtube: boolean } | null>(null);
const [youtubeHandle, setYoutubeHandle] = useState('');
```

In the `useEffect` that currently only calls `/api/session`, add a second, independent fetch once bootstrap succeeds (do not block the session bootstrap on this — Settings should render even if this call fails):

```ts
useEffect(() => {
  if (state.status !== 'loaded') return;
  fetch('/api/settings/platforms')
    .then((res) => res.json())
    .then((data) => setPlatforms({ tiktok: Boolean(data.tiktok), instagram: Boolean(data.instagram), youtube: Boolean(data.youtube) }))
    .catch(() => {});
}, [state.status]);

async function disconnectPlatform(platform: 'tiktok' | 'instagram') {
  const res = await fetch(`/api/oauth/${platform}/disconnect`, { method: 'POST' });
  if (res.ok) {
    setPlatforms((prev) => (prev ? { ...prev, [platform]: false } : prev));
  }
}

async function saveYoutubeHandle(handle: string) {
  await fetch('/api/settings/platforms/youtube', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ handle: handle.trim() || null }),
  });
}
```

Replace the Platforms `<section>` body's `.map(...)` block:

```tsx
{(['youtube', 'tiktok', 'instagram'] as const).map((platform) => {
  const connected = platforms?.[platform] ?? false;
  if (platform === 'youtube') {
    return (
      <div
        key={platform}
        className="flex items-center justify-between gap-3.5 rounded-xl border border-[#eeeef2] bg-[#fafafb] px-4 py-3.5"
      >
        <div className="flex min-w-0 items-center gap-3">
          <PlatformBadge platform={platform} />
          <label className="flex min-w-0 flex-col gap-0.5 text-sm font-semibold text-gray-700">
            YouTube handle
            <input
              type="text"
              defaultValue={youtubeHandle}
              onChange={(e) => setYoutubeHandle(e.target.value)}
              onBlur={(e) => saveYoutubeHandle(e.target.value)}
              placeholder="@channel"
              className="rounded-md border border-[#d8d8e0] px-2 py-1 text-sm font-normal text-gray-900"
            />
          </label>
        </div>
        <span className={`font-mono text-[11px] tracking-[.04em] ${connected ? 'text-[#047857]' : 'text-gray-500'}`}>
          {connected ? 'Connected' : 'Not connected'}
        </span>
      </div>
    );
  }
  return (
    <div
      key={platform}
      className="flex items-center justify-between gap-3.5 rounded-xl border border-[#eeeef2] bg-[#fafafb] px-4 py-3.5"
    >
      <div className="flex min-w-0 items-center gap-3">
        <PlatformBadge platform={platform} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm font-semibold text-gray-700">{PLATFORM_NAMES[platform]}</span>
          <span className={`font-mono text-[11px] tracking-[.04em] ${connected ? 'text-[#047857]' : 'text-gray-500'}`}>
            {connected ? 'Connected' : 'Not connected'}
          </span>
        </div>
      </div>
      {connected ? (
        <button
          type="button"
          onClick={() => disconnectPlatform(platform)}
          className="flex-none whitespace-nowrap rounded-full border border-[#d8d8e0] px-4 py-2 text-[13px] font-semibold text-[#6d28d9]"
        >
          Disconnect
        </button>
      ) : (
        <a
          href={`/api/oauth/${platform}/authorize`}
          className="flex-none whitespace-nowrap rounded-full bg-brand px-4 py-2 text-[13px] font-semibold text-white"
        >
          Connect
        </a>
      )}
    </div>
  );
})}
```

Update the top "Preview" `Banner`'s body text to drop "connected platforms" from the not-saved list — and drop "Profile details" too, since Tasks 1-2 already made display name and email real (the plan's original banner text predates those tasks and was never corrected until now):

```tsx
<Banner variant="info" label="Preview">
  This page previews the redesigned Settings screen. Password, two-factor, notifications, and locale aren&apos;t
  saved yet. Profile details, connected platforms, billing, and sign out work normally.
</Banner>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/app/settings/page.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/settings/page.tsx tests/unit/app/settings/page.test.tsx
git commit -m "feat(settings): wire real platform connect/disconnect"
```

---

### Task 5: Timezone/locale migration and persistence

**Files:**
- Create: `supabase/migrations/20260930000001_add_timezone_locale_to_profiles.sql`
- Modify: `lib/supabase/types.ts`
- Create: `lib/settings/locale-handler.ts`
- Create: `app/api/settings/locale/route.ts`
- Modify: `app/settings/page.tsx`
- Test: `tests/unit/supabase/migrations.test.ts`
- Test: `tests/unit/lib/settings/locale-handler.test.ts`
- Test: `tests/unit/app/settings/page.test.tsx`

**Interfaces:**
- Produces: `profiles.timezone` / `profiles.locale` columns (default `'UTC'` / `'en-US'`), `handleUpdateLocale(deps, context)`, `PATCH /api/settings/locale`, consumed by Task 6.

- [ ] **Step 1: Write the failing migration test**

Add to `tests/unit/supabase/migrations.test.ts`:

```ts
it('includes a migration adding timezone and locale to profiles', () => {
  const sql = readMigrationContaining('add_timezone_locale_to_profiles');
  expect(sql).toContain("add column timezone text not null default 'UTC'");
  expect(sql).toContain("add column locale text not null default 'en-US'");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/supabase/migrations.test.ts`
Expected: FAIL with `No migration file matching "add_timezone_locale_to_profiles"`

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260930000001_add_timezone_locale_to_profiles.sql`:

```sql
alter table public.profiles
  add column timezone text not null default 'UTC',
  add column locale text not null default 'en-US';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/supabase/migrations.test.ts`
Expected: PASS

- [ ] **Step 5: Update `lib/supabase/types.ts`**

In `Database['public']['Tables']['profiles']`, add to `Row`:

```ts
timezone: string;
locale: string;
```

Add to `Insert`:

```ts
timezone?: string;
locale?: string;
```

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Write the failing handler tests**

Create `tests/unit/lib/settings/locale-handler.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { handleUpdateLocale, ALLOWED_LOCALES, type UpdateLocaleDeps } from '@/lib/settings/locale-handler';

function makeDeps(overrides: Partial<UpdateLocaleDeps> = {}): UpdateLocaleDeps {
  return { saveLocale: vi.fn().mockResolvedValue(undefined), ...overrides };
}

describe('handleUpdateLocale', () => {
  it('returns 401 when not signed in', async () => {
    const result = await handleUpdateLocale(makeDeps(), { profileId: null, timezone: undefined, locale: undefined });
    expect(result.status).toBe(401);
  });

  it('returns 400 for an unrecognized timezone', async () => {
    const result = await handleUpdateLocale(makeDeps(), {
      profileId: 'profile-1',
      timezone: 'Not/A_Zone',
      locale: undefined,
    });
    expect(result.status).toBe(400);
  });

  it('returns 400 for a locale outside the fixed allowlist', async () => {
    const result = await handleUpdateLocale(makeDeps(), {
      profileId: 'profile-1',
      timezone: undefined,
      locale: 'xx-XX',
    });
    expect(result.status).toBe(400);
  });

  it('saves a valid timezone only, leaving locale untouched', async () => {
    const saveLocale = vi.fn().mockResolvedValue(undefined);
    const result = await handleUpdateLocale(makeDeps({ saveLocale }), {
      profileId: 'profile-1',
      timezone: 'America/Los_Angeles',
      locale: undefined,
    });
    expect(result.status).toBe(200);
    expect(saveLocale).toHaveBeenCalledWith('profile-1', { timezone: 'America/Los_Angeles', locale: undefined });
  });

  it('saves a valid locale from the fixed allowlist', async () => {
    const saveLocale = vi.fn().mockResolvedValue(undefined);
    const result = await handleUpdateLocale(makeDeps({ saveLocale }), {
      profileId: 'profile-1',
      timezone: undefined,
      locale: ALLOWED_LOCALES[0],
    });
    expect(result.status).toBe(200);
    expect(saveLocale).toHaveBeenCalledWith('profile-1', { timezone: undefined, locale: ALLOWED_LOCALES[0] });
  });
});
```

- [ ] **Step 7: Run tests to verify they fail**

Run: `npx vitest run tests/unit/lib/settings/locale-handler.test.ts`
Expected: FAIL with `Cannot find module '@/lib/settings/locale-handler'`

- [ ] **Step 8: Implement the handler**

Create `lib/settings/locale-handler.ts`:

```ts
// Matches the five options in app/settings/page.tsx's Language <select>.
export const ALLOWED_LOCALES = ['en-US', 'en-GB', 'es-ES', 'pt-BR', 'de-DE'] as const;

export interface UpdateLocaleDeps {
  saveLocale: (profileId: string, params: { timezone?: string; locale?: string }) => Promise<void>;
}

export interface UpdateLocaleContext {
  profileId: string | null;
  timezone: string | undefined;
  locale: string | undefined;
}

export interface UpdateLocaleResult {
  status: number;
  body: Record<string, unknown>;
}

function isValidTimezone(value: string): boolean {
  try {
    return Intl.supportedValuesOf('timeZone').includes(value);
  } catch {
    return false;
  }
}

export async function handleUpdateLocale(deps: UpdateLocaleDeps, context: UpdateLocaleContext): Promise<UpdateLocaleResult> {
  if (!context.profileId) {
    return { status: 401, body: { error: 'You must be signed in.' } };
  }
  if (context.timezone !== undefined && !isValidTimezone(context.timezone)) {
    return { status: 400, body: { error: 'Unrecognized timezone.' } };
  }
  if (context.locale !== undefined && !(ALLOWED_LOCALES as readonly string[]).includes(context.locale)) {
    return { status: 400, body: { error: 'Unrecognized language.' } };
  }

  await deps.saveLocale(context.profileId, { timezone: context.timezone, locale: context.locale });
  return { status: 200, body: { ok: true } };
}
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npx vitest run tests/unit/lib/settings/locale-handler.test.ts`
Expected: PASS

- [ ] **Step 10: Create the route**

Create `app/api/settings/locale/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { handleUpdateLocale } from '@/lib/settings/locale-handler';

export async function PATCH(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const serviceClient = createSupabaseServiceRoleClient();
  const body = await request.json().catch(() => ({}));

  const result = await handleUpdateLocale(
    {
      saveLocale: async (profileId, params) => {
        const update: Record<string, string> = {};
        if (params.timezone !== undefined) update.timezone = params.timezone;
        if (params.locale !== undefined) update.locale = params.locale;
        const { error } = await serviceClient.from('profiles').update(update).eq('id', profileId);
        if (error) {
          throw new Error(`Failed to save locale: ${error.message}`);
        }
      },
    },
    {
      profileId: user?.id ?? null,
      timezone: typeof body.timezone === 'string' ? body.timezone : undefined,
      locale: typeof body.locale === 'string' ? body.locale : undefined,
    }
  );

  return NextResponse.json(result.body, { status: result.status });
}
```

- [ ] **Step 11: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 12: Fix the timezone select's values and wire saving**

In `app/settings/page.tsx`, the existing Locale `<section>`'s two `<select>`s use display strings as `value` — replace with real IANA values on the timezone select, and wire both to save on change. Replace the section body:

```tsx
<label className="flex flex-col gap-1.5 text-[13px] font-semibold text-gray-700">
  Timezone
  <select
    value={timezone}
    onChange={async (e) => {
      setTimezone(e.target.value);
      await fetch('/api/settings/locale', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timezone: e.target.value }),
      });
    }}
    className="rounded-[10px] border border-[#d8d8e0] px-[14px] py-[10px] font-normal text-gray-900"
  >
    <option value="America/Los_Angeles">(GMT-08:00) Pacific Time</option>
    <option value="America/New_York">(GMT-05:00) Eastern Time</option>
    <option value="Europe/London">(GMT+00:00) London</option>
    <option value="Europe/Berlin">(GMT+01:00) Central European Time</option>
    <option value="Asia/Tokyo">(GMT+09:00) Tokyo</option>
  </select>
</label>
<label className="flex flex-col gap-1.5 text-[13px] font-semibold text-gray-700">
  Language
  <select
    value={language}
    onChange={async (e) => {
      setLanguage(e.target.value);
      await fetch('/api/settings/locale', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale: e.target.value }),
      });
    }}
    className="rounded-[10px] border border-[#d8d8e0] px-[14px] py-[10px] font-normal text-gray-900"
  >
    <option value="en-US">English (US)</option>
    <option value="en-GB">English (UK)</option>
    <option value="es-ES">Español</option>
    <option value="pt-BR">Português (Brasil)</option>
    <option value="de-DE">Deutsch</option>
  </select>
</label>
```

Update the default `timezone` `useState` initializer to an IANA value: `useState('America/Los_Angeles')`, and `language` to `useState('en-US')`.

Also update the top Preview banner to drop "locale" from the not-saved list, and the `youtube handle` label added in Task 4 stays unaffected by this task.

```tsx
<Banner variant="info" label="Preview">
  This page previews the redesigned Settings screen. Password, two-factor, and notifications aren&apos;t saved yet.
  Profile details, connected platforms, locale, billing, and sign out work normally.
</Banner>
```

- [ ] **Step 13: Add a frontend test**

Add to `tests/unit/app/settings/page.test.tsx`:

```ts
it('saves the timezone on change', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({ status: 200, json: async () => ({ email: 'creator@example.com' }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ tiktok: false, instagram: false, youtube: false }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
  vi.stubGlobal('fetch', fetchMock);

  render(<SettingsPage />);
  const select = await screen.findByLabelText(/^timezone$/i);
  fireEvent.change(select, { target: { value: 'Europe/London' } });

  await waitFor(() =>
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/settings/locale',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ timezone: 'Europe/London' }) })
    )
  );
});
```

- [ ] **Step 14: Run tests to verify they pass**

Run: `npx vitest run tests/unit/app/settings/page.test.tsx`
Expected: PASS

- [ ] **Step 15: Commit**

```bash
git add supabase/migrations/20260930000001_add_timezone_locale_to_profiles.sql lib/supabase/types.ts lib/settings/locale-handler.ts app/api/settings/locale/route.ts app/settings/page.tsx tests/unit/supabase/migrations.test.ts tests/unit/lib/settings/locale-handler.test.ts tests/unit/app/settings/page.test.tsx
git commit -m "feat(settings): persist timezone and locale"
```

---

### Task 6: Apply timezone to Billing and Home date formatting

**Files:**
- Create: `lib/format/timezone.ts`
- Modify: `app/api/billing/status/route.ts`
- Modify: `lib/billing/page-state.ts`
- Modify: `app/billing/page.tsx`
- Modify: `app/api/home/route.ts`
- Modify: `lib/home/types.ts`
- Modify: `app/home/page.tsx`
- Test: `tests/unit/lib/format/timezone.test.ts`
- Test: `tests/unit/lib/billing/page-state.test.ts`

**Interfaces:**
- Consumes: `profiles.timezone` (Task 5).
- Produces: `formatDateInTimezone(iso, timezone, opts)`, consumed by `app/billing/page.tsx` and `app/home/page.tsx`.

- [ ] **Step 1: Write the failing helper test**

Create `tests/unit/lib/format/timezone.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatDateInTimezone } from '@/lib/format/timezone';

describe('formatDateInTimezone', () => {
  it('formats a date in the given timezone', () => {
    // 2026-09-19T01:00:00Z is Sept 18 evening in Los Angeles (UTC-7 in September, DST)
    const result = formatDateInTimezone('2026-09-19T01:00:00Z', 'America/Los_Angeles', {
      month: 'long',
      day: 'numeric',
    });
    expect(result).toBe('September 18');
  });

  it('formats the same instant differently in a different timezone', () => {
    const result = formatDateInTimezone('2026-09-19T01:00:00Z', 'Asia/Tokyo', { month: 'long', day: 'numeric' });
    expect(result).toBe('September 19');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/format/timezone.test.ts`
Expected: FAIL with `Cannot find module '@/lib/format/timezone'`

- [ ] **Step 3: Implement**

Create `lib/format/timezone.ts`:

```ts
export function formatDateInTimezone(iso: string, timezone: string, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: timezone }).format(new Date(iso));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/format/timezone.test.ts`
Expected: PASS

- [ ] **Step 5: Thread timezone through Billing's state and page**

In `lib/billing/page-state.ts`, add `timezone: string` to the `'subscribed'` state variant:

```ts
| {
    status: 'subscribed';
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    pastDue: boolean;
    justSubscribed?: boolean;
    timezone: string;
  }
```

Add `timezone: string` to `BillingStatusData`'s non-free variant:

```ts
export type BillingStatusData =
  | { status: 'free' }
  | { status: 'active' | 'past_due'; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; timezone: string };
```

In the `BOOTSTRAPPED` reducer case, thread it through:

```ts
return {
  status: 'subscribed',
  currentPeriodEnd: event.data.currentPeriodEnd,
  cancelAtPeriodEnd: event.data.cancelAtPeriodEnd,
  pastDue: event.data.status === 'past_due',
  timezone: event.data.timezone,
  ...(event.justSubscribed ? { justSubscribed: true } : {}),
};
```

Add a test to `tests/unit/lib/billing/page-state.test.ts` (extend the two existing `BOOTSTRAPPED` subscribed-state tests to include `timezone: 'America/Los_Angeles'` in both the event payload and the expected result — follow the existing test pattern exactly, adding the field to the `data` object and to the `toEqual` expectation).

Run: `npx vitest run tests/unit/lib/billing/page-state.test.ts`
Expected: PASS after adding `timezone` to those two tests' data and expectations.

In `app/api/billing/status/route.ts`, select the profile's timezone alongside the subscription and include it in the response:

```ts
export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 });
  }

  const serviceClient = createSupabaseServiceRoleClient();
  const [{ data }, { data: profile }] = await Promise.all([
    serviceClient.from('subscriptions').select('status,current_period_end,cancel_at_period_end').eq('profile_id', user.id).maybeSingle(),
    serviceClient.from('profiles').select('timezone').eq('id', user.id).single(),
  ]);
  const timezone = profile?.timezone ?? 'UTC';

  if (!data || (data.status !== 'active' && data.status !== 'past_due')) {
    return NextResponse.json({ status: 'free' });
  }

  return NextResponse.json({
    status: data.status,
    currentPeriodEnd: data.current_period_end,
    cancelAtPeriodEnd: data.cancel_at_period_end,
    timezone,
  });
}
```

In `app/billing/page.tsx`, import `formatDateInTimezone` and replace both `new Date(state.currentPeriodEnd).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })` call sites with `formatDateInTimezone(state.currentPeriodEnd, state.timezone, { month: 'long', day: 'numeric' })`.

- [ ] **Step 6: Thread timezone through Home's data and page**

In `lib/home/types.ts`, add `timezone: string` to `HomeData`:

```ts
export interface HomeData {
  email: string;
  timezone: string;
  diagnostic: HomeDiagnosticSummary | null;
  recap: HomeRecapSummary | null;
  ideas: HomeIdeasSummary;
}
```

In `app/api/home/route.ts`, the existing `Promise.all` already fetches `profiles` (currently `.select('niche')`) — extend that select and thread the field through:

```ts
serviceClient.from('profiles').select('niche, timezone').eq('id', user.id).single(),
```

```ts
const homeData: HomeData = {
  email: user.email ?? '',
  timezone: profile?.timezone ?? 'UTC',
  diagnostic: diagnosticRow
  // ...unchanged below
```

In `app/home/page.tsx`, import `formatDateInTimezone` and replace the recap month-name line:

```ts
const monthName = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(
  new Date(recap.month)
);
```

with:

```ts
const monthName = formatDateInTimezone(recap.month, data.timezone, { month: 'long' });
```

(`RecapCard`'s function signature needs `data: HomeData` passed down alongside `recap: HomeData['recap']` — pass `data.timezone` as a new prop, e.g. `<RecapCard recap={data.recap} timezone={data.timezone} />` and add `timezone: string` to `RecapCard`'s props, using it in place of `data.timezone` inside the function).

- [ ] **Step 7: Update existing tests that construct BillingStatusData/HomeData**

Run: `npx vitest run tests/unit/app/billing tests/unit/app/home tests/unit/lib/billing tests/unit/lib/home 2>&1 || true`

Any test mocking a `/api/billing/status` or `/api/home` JSON response for a subscribed/populated state needs `timezone: 'UTC'` (or any valid IANA string) added to its mock response body — go through each failure, add the field to that test's existing mock JSON literal, matching this plan's convention of extending existing test fixtures rather than rewriting them.

- [ ] **Step 8: Run the full suite and typecheck**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add lib/format/timezone.ts app/api/billing/status/route.ts lib/billing/page-state.ts app/billing/page.tsx app/api/home/route.ts lib/home/types.ts app/home/page.tsx tests/unit/lib/format/timezone.test.ts tests/unit/lib/billing/page-state.test.ts
git commit -am "feat(settings): apply saved timezone to Billing and Home date formatting"
```

---

### Task 7: Two-factor enrollment (MFA enroll)

**Files:**
- Create: `lib/settings/mfa-handler.ts`
- Create: `app/api/settings/mfa/enroll/route.ts`
- Test: `tests/unit/lib/settings/mfa-handler.test.ts`

**Interfaces:**
- Consumes: nothing new — Supabase Auth owns factor state, no migration.
- Produces: `handleEnrollMfa(deps, context)`, `POST /api/settings/mfa/enroll`, consumed by Task 10's frontend.

- [ ] **Step 1: Write the failing handler test**

Create `tests/unit/lib/settings/mfa-handler.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { handleEnrollMfa, type EnrollMfaDeps } from '@/lib/settings/mfa-handler';

describe('handleEnrollMfa', () => {
  it('returns 401 when not signed in', async () => {
    const result = await handleEnrollMfa({ enroll: vi.fn() }, { profileId: null });
    expect(result.status).toBe(401);
  });

  it('returns the factor id, QR code, and secret on success', async () => {
    const enroll = vi.fn().mockResolvedValue({
      data: { id: 'factor-1', totp: { qr_code: '<svg>...</svg>', secret: 'JBSWY3DPEHPK3PXP' } },
      error: null,
    });
    const deps: EnrollMfaDeps = { enroll };
    const result = await handleEnrollMfa(deps, { profileId: 'profile-1' });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ factorId: 'factor-1', qrCode: '<svg>...</svg>', secret: 'JBSWY3DPEHPK3PXP' });
  });

  it('returns 500 with a generic message when enrollment fails', async () => {
    const deps: EnrollMfaDeps = { enroll: vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } }) };
    const result = await handleEnrollMfa(deps, { profileId: 'profile-1' });
    expect(result.status).toBe(500);
    expect(result.body.error).toBe('Something went wrong setting up two-factor authentication. Please try again.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/settings/mfa-handler.test.ts`
Expected: FAIL with `Cannot find module '@/lib/settings/mfa-handler'`

- [ ] **Step 3: Implement**

Create `lib/settings/mfa-handler.ts`:

```ts
export interface MfaEnrollData {
  id: string;
  totp: { qr_code: string; secret: string };
}

export interface EnrollMfaDeps {
  enroll: () => Promise<{ data: MfaEnrollData | null; error: { message: string } | null }>;
}

export interface EnrollMfaContext {
  profileId: string | null;
}

export interface EnrollMfaResult {
  status: number;
  body: Record<string, unknown>;
}

export async function handleEnrollMfa(deps: EnrollMfaDeps, context: EnrollMfaContext): Promise<EnrollMfaResult> {
  if (!context.profileId) {
    return { status: 401, body: { error: 'You must be signed in.' } };
  }

  const { data, error } = await deps.enroll();
  if (error || !data) {
    return { status: 500, body: { error: 'Something went wrong setting up two-factor authentication. Please try again.' } };
  }

  return {
    status: 200,
    body: { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/settings/mfa-handler.test.ts`
Expected: PASS

- [ ] **Step 5: Create the route**

Create `app/api/settings/mfa/enroll/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { handleEnrollMfa } from '@/lib/settings/mfa-handler';

export async function POST() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const result = await handleEnrollMfa(
    {
      enroll: async () => {
        const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp' });
        return { data: data as { id: string; totp: { qr_code: string; secret: string } } | null, error };
      },
    },
    { profileId: user?.id ?? null }
  );

  return NextResponse.json(result.body, { status: result.status });
}
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. If the installed `@supabase/supabase-js` version's `mfa.enroll` response type doesn't structurally match `MfaEnrollData`, adjust the cast in the route (not the handler, which stays intentionally decoupled from the SDK's exact types) to match the real shape — the handler's own test (Step 1-4) already locks in the contract the rest of this feature depends on.

- [ ] **Step 7: Commit**

```bash
git add lib/settings/mfa-handler.ts app/api/settings/mfa/enroll/route.ts tests/unit/lib/settings/mfa-handler.test.ts
git commit -m "feat(settings): add MFA enrollment endpoint"
```

---

### Task 8: Two-factor verify and disable

**Files:**
- Modify: `lib/settings/mfa-handler.ts`
- Create: `app/api/settings/mfa/verify/route.ts`
- Create: `app/api/settings/mfa/disable/route.ts`
- Test: `tests/unit/lib/settings/mfa-handler.test.ts`

**Interfaces:**
- Consumes: `checkAndRecordRateLimit`, `hashIdentity` (existing, `lib/rate-limit.ts`); the `factorId` from Task 7's enroll response.
- Produces: `handleVerifyMfa(deps, context)`, `handleDisableMfa(deps, context)`, `POST /api/settings/mfa/verify`, `POST /api/settings/mfa/disable`, consumed by Task 9 (verify's challenge/verify pair is reused by the auth-callback flow) and Task 10 (frontend).

- [ ] **Step 1: Write the failing handler tests**

Add to `tests/unit/lib/settings/mfa-handler.test.ts`:

```ts
import { handleVerifyMfa, handleDisableMfa, type VerifyMfaDeps, type DisableMfaDeps } from '@/lib/settings/mfa-handler';
import { createInMemoryRateLimitStore } from '@/tests/fakes/rate-limit-store.fake';

describe('handleVerifyMfa', () => {
  function makeDeps(overrides: Partial<VerifyMfaDeps> = {}): VerifyMfaDeps {
    return {
      rateLimitStore: createInMemoryRateLimitStore(),
      challengeAndVerify: vi.fn().mockResolvedValue({ error: null }),
      ...overrides,
    };
  }

  it('returns 401 when not signed in', async () => {
    const result = await handleVerifyMfa(makeDeps(), { profileId: null, factorId: 'factor-1', code: '123456' });
    expect(result.status).toBe(401);
  });

  it('verifies a correct code', async () => {
    const challengeAndVerify = vi.fn().mockResolvedValue({ error: null });
    const result = await handleVerifyMfa(makeDeps({ challengeAndVerify }), {
      profileId: 'profile-1',
      factorId: 'factor-1',
      code: '123456',
    });
    expect(result.status).toBe(200);
    expect(challengeAndVerify).toHaveBeenCalledWith('factor-1', '123456');
  });

  it('returns 400 with a generic message on an incorrect code', async () => {
    const deps = makeDeps({ challengeAndVerify: vi.fn().mockResolvedValue({ error: { message: 'Invalid TOTP code' } }) });
    const result = await handleVerifyMfa(deps, { profileId: 'profile-1', factorId: 'factor-1', code: '000000' });
    expect(result.status).toBe(400);
    expect(result.body.error).toBe('Incorrect code. Please try again.');
  });

  it('rate-limits repeated attempts for the same profile', async () => {
    const store = createInMemoryRateLimitStore();
    const deps = makeDeps({ rateLimitStore: store, challengeAndVerify: vi.fn().mockResolvedValue({ error: { message: 'bad' } }) });
    for (let i = 0; i < 5; i++) {
      await handleVerifyMfa(deps, { profileId: 'profile-1', factorId: 'factor-1', code: '000000' });
    }
    const result = await handleVerifyMfa(deps, { profileId: 'profile-1', factorId: 'factor-1', code: '000000' });
    expect(result.status).toBe(429);
  });
});

describe('handleDisableMfa', () => {
  function makeDeps(overrides: Partial<DisableMfaDeps> = {}): DisableMfaDeps {
    return {
      rateLimitStore: createInMemoryRateLimitStore(),
      challengeAndVerify: vi.fn().mockResolvedValue({ error: null }),
      unenroll: vi.fn().mockResolvedValue({ error: null }),
      ...overrides,
    };
  }

  it('returns 401 when not signed in', async () => {
    const result = await handleDisableMfa(makeDeps(), { profileId: null, factorId: 'factor-1', code: '123456' });
    expect(result.status).toBe(401);
  });

  it('requires a valid code before unenrolling', async () => {
    const unenroll = vi.fn().mockResolvedValue({ error: null });
    const deps = makeDeps({ unenroll });
    const result = await handleDisableMfa(deps, { profileId: 'profile-1', factorId: 'factor-1', code: '123456' });
    expect(result.status).toBe(200);
    expect(unenroll).toHaveBeenCalledWith('factor-1');
  });

  it('does not unenroll when the code is wrong', async () => {
    const unenroll = vi.fn();
    const deps = makeDeps({ challengeAndVerify: vi.fn().mockResolvedValue({ error: { message: 'bad' } }), unenroll });
    const result = await handleDisableMfa(deps, { profileId: 'profile-1', factorId: 'factor-1', code: '000000' });
    expect(result.status).toBe(400);
    expect(unenroll).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/lib/settings/mfa-handler.test.ts`
Expected: FAIL — `handleVerifyMfa`/`handleDisableMfa` don't exist yet.

- [ ] **Step 3: Implement**

Add to `lib/settings/mfa-handler.ts`:

```ts
import { checkAndRecordRateLimit, type RateLimitStore } from '@/lib/rate-limit';

export interface VerifyMfaDeps {
  rateLimitStore: RateLimitStore;
  // Wraps supabase.auth.mfa.challenge + .verify as one call — see route wiring.
  challengeAndVerify: (factorId: string, code: string) => Promise<{ error: { message: string } | null }>;
}

export interface VerifyMfaContext {
  profileId: string | null;
  factorId: string;
  code: string;
}

export interface VerifyMfaResult {
  status: number;
  body: Record<string, unknown>;
}

// A TOTP code is only 6 digits — cap attempts so it isn't brute-forceable.
const MFA_VERIFY_ATTEMPT_LIMIT = 5;
const MFA_VERIFY_WINDOW_MINUTES = 10;

export async function handleVerifyMfa(deps: VerifyMfaDeps, context: VerifyMfaContext): Promise<VerifyMfaResult> {
  if (!context.profileId) {
    return { status: 401, body: { error: 'You must be signed in.' } };
  }

  const rateLimitResult = await checkAndRecordRateLimit({
    store: deps.rateLimitStore,
    profileId: context.profileId,
    ipHash: 'n/a', // profile-scoped only; no per-IP limit needed for an already-authenticated action
    eventType: 'mfa_verify_attempt',
    profileLimit: MFA_VERIFY_ATTEMPT_LIMIT,
    ipLimit: Number.MAX_SAFE_INTEGER,
    windowDays: MFA_VERIFY_WINDOW_MINUTES / (24 * 60),
  });
  if (!rateLimitResult.allowed) {
    return { status: 429, body: { error: 'Too many attempts. Please wait a few minutes and try again.' } };
  }

  const { error } = await deps.challengeAndVerify(context.factorId, context.code);
  if (error) {
    return { status: 400, body: { error: 'Incorrect code. Please try again.' } };
  }

  return { status: 200, body: { ok: true } };
}

export interface DisableMfaDeps {
  rateLimitStore: RateLimitStore;
  challengeAndVerify: (factorId: string, code: string) => Promise<{ error: { message: string } | null }>;
  unenroll: (factorId: string) => Promise<{ error: { message: string } | null }>;
}

export interface DisableMfaContext {
  profileId: string | null;
  factorId: string;
  code: string;
}

export interface DisableMfaResult {
  status: number;
  body: Record<string, unknown>;
}

export async function handleDisableMfa(deps: DisableMfaDeps, context: DisableMfaContext): Promise<DisableMfaResult> {
  if (!context.profileId) {
    return { status: 401, body: { error: 'You must be signed in.' } };
  }

  const rateLimitResult = await checkAndRecordRateLimit({
    store: deps.rateLimitStore,
    profileId: context.profileId,
    ipHash: 'n/a',
    eventType: 'mfa_disable_attempt',
    profileLimit: MFA_VERIFY_ATTEMPT_LIMIT,
    ipLimit: Number.MAX_SAFE_INTEGER,
    windowDays: MFA_VERIFY_WINDOW_MINUTES / (24 * 60),
  });
  if (!rateLimitResult.allowed) {
    return { status: 429, body: { error: 'Too many attempts. Please wait a few minutes and try again.' } };
  }

  const { error: verifyError } = await deps.challengeAndVerify(context.factorId, context.code);
  if (verifyError) {
    return { status: 400, body: { error: 'Incorrect code. Please try again.' } };
  }

  const { error: unenrollError } = await deps.unenroll(context.factorId);
  if (unenrollError) {
    return { status: 500, body: { error: 'Something went wrong turning off two-factor authentication. Please try again.' } };
  }

  return { status: 200, body: { ok: true } };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/lib/settings/mfa-handler.test.ts`
Expected: PASS

- [ ] **Step 5: Create the routes**

Create `app/api/settings/mfa/verify/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { createSupabaseRateLimitStore } from '@/lib/supabase/rate-limit-store';
import { handleVerifyMfa } from '@/lib/settings/mfa-handler';

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const body = await request.json().catch(() => ({}));

  const result = await handleVerifyMfa(
    {
      rateLimitStore: createSupabaseRateLimitStore(createSupabaseServiceRoleClient()),
      challengeAndVerify: async (factorId, code) => {
        const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
        if (challengeError || !challenge) {
          return { error: challengeError ?? { message: 'Challenge failed' } };
        }
        const { error } = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, code });
        return { error };
      },
    },
    {
      profileId: user?.id ?? null,
      factorId: typeof body.factorId === 'string' ? body.factorId : '',
      code: typeof body.code === 'string' ? body.code : '',
    }
  );

  return NextResponse.json(result.body, { status: result.status });
}
```

Create `app/api/settings/mfa/disable/route.ts`, following the identical wiring shape but calling `handleDisableMfa` and adding `unenroll: async (factorId) => supabase.auth.mfa.unenroll({ factorId })` alongside the same `challengeAndVerify`.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add lib/settings/mfa-handler.ts app/api/settings/mfa/verify/route.ts app/api/settings/mfa/disable/route.ts tests/unit/lib/settings/mfa-handler.test.ts
git commit -m "feat(settings): add MFA verify and disable endpoints"
```

---

### Task 9: Enforce MFA after magic-link sign-in

**Files:**
- Modify: `lib/auth/callback.ts`
- Modify: `app/auth/callback/route.ts`
- Create: `app/auth/mfa-challenge/page.tsx`
- Test: `tests/unit/lib/auth/callback.test.ts`
- Test: `tests/unit/app/auth/mfa-challenge/page.test.tsx`

**Interfaces:**
- Consumes: `POST /api/settings/mfa/verify` (Task 8, reused as-is — the challenge page needs no new endpoint).
- Produces: `CallbackHandlerDeps.hasVerifiedMfaFactor`, consumed only by `app/auth/callback/route.ts`'s own wiring.

- [ ] **Step 1: Find and read the existing callback test file's current shape**

Run: `cat tests/unit/lib/auth/callback.test.ts` and note its existing `makeDeps`-style helper (or equivalent inline deps object) before editing — this task extends it rather than replacing it, and the exact helper name may differ slightly from what's assumed below; match what you find.

- [ ] **Step 2: Write the failing tests**

Add to `tests/unit/lib/auth/callback.test.ts` (adapt the deps object to match whatever helper the existing tests use, adding `hasVerifiedMfaFactor` to it):

```ts
it('redirects to the MFA challenge page instead of next when the user has a verified MFA factor', async () => {
  const result = await handleAuthCallback(
    {
      exchangeCodeForSession: async () => ({ error: null }),
      hasVerifiedMfaFactor: async () => true,
    },
    { code: 'valid-code', next: '/ideas', origin: 'https://app.example.com' }
  );
  expect(result.redirectUrl).toBe('https://app.example.com/auth/mfa-challenge?next=%2Fideas');
});

it('redirects straight to next when there is no verified MFA factor', async () => {
  const result = await handleAuthCallback(
    {
      exchangeCodeForSession: async () => ({ error: null }),
      hasVerifiedMfaFactor: async () => false,
    },
    { code: 'valid-code', next: '/ideas', origin: 'https://app.example.com' }
  );
  expect(result.redirectUrl).toBe('https://app.example.com/ideas');
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/unit/lib/auth/callback.test.ts`
Expected: FAIL — `hasVerifiedMfaFactor` is not part of `CallbackHandlerDeps` yet, and the success branch doesn't check it.

- [ ] **Step 4: Implement**

In `lib/auth/callback.ts`, update `CallbackHandlerDeps` and the success branch of `handleAuthCallback`:

```ts
export interface CallbackHandlerDeps {
  exchangeCodeForSession: (code: string) => Promise<{ error: { message: string } | null }>;
  hasVerifiedMfaFactor: () => Promise<boolean>;
}
```

```ts
export async function handleAuthCallback(
  deps: CallbackHandlerDeps,
  context: CallbackRequestContext
): Promise<CallbackHandlerResult> {
  if (context.code) {
    const { error } = await deps.exchangeCodeForSession(context.code);
    if (!error) {
      const safeNext = isSafeRelativePath(context.next) ? context.next : '/diagnostic';
      // The session already exists at AAL1 (magic-link-verified) here. An
      // account with 2FA on must clear a second, TOTP challenge before
      // reaching its destination — see design spec §5.
      if (await deps.hasVerifiedMfaFactor()) {
        const challengeUrl = new URL('/auth/mfa-challenge', context.origin);
        challengeUrl.searchParams.set('next', safeNext);
        return { redirectUrl: challengeUrl.toString() };
      }
      return { redirectUrl: new URL(safeNext, context.origin).toString() };
    }
  }

  const preservedUrl = extractUrlParam(context.next);
  const failureRedirect = new URL('/diagnostic', context.origin);
  failureRedirect.searchParams.set('authError', 'expired');
  if (preservedUrl) {
    failureRedirect.searchParams.set('url', preservedUrl);
  }
  return { redirectUrl: failureRedirect.toString() };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/lib/auth/callback.test.ts`
Expected: PASS. If other existing tests in this file break because they build a deps object without `hasVerifiedMfaFactor`, add `hasVerifiedMfaFactor: async () => false` to each of their deps objects — this is the "no MFA enrolled" default and preserves every existing test's original behavior/assertions unchanged.

- [ ] **Step 6: Wire the real dependency in the route**

In `app/auth/callback/route.ts`, add the real check. Read the file first to match its existing structure; add, alongside the existing `exchangeCodeForSession` wiring:

```ts
hasVerifiedMfaFactor: async () => {
  const { data } = await supabase.auth.mfa.listFactors();
  return (data?.totp ?? []).some((factor) => factor.status === 'verified');
},
```

(`supabase` here is the same request-scoped client already used for `exchangeCodeForSession` in this file — the MFA check must run against the session that was just created by the code exchange, not a separate client.)

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 8: Create the MFA challenge page and its test**

Create `tests/unit/app/auth/mfa-challenge/page.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => new URLSearchParams('next=%2Fideas'),
}));

import MfaChallengePage from '@/app/auth/mfa-challenge/page';

describe('MfaChallengePage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    pushMock.mockClear();
  });

  it('submits the code and redirects to next on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
    render(<MfaChallengePage />);

    fireEvent.change(screen.getByLabelText(/verification code/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /verify/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/ideas'));
  });

  it('shows an error and does not redirect on an incorrect code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Incorrect code. Please try again.' }) }));
    render(<MfaChallengePage />);

    fireEvent.change(screen.getByLabelText(/verification code/i), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: /verify/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Incorrect code'));
    expect(pushMock).not.toHaveBeenCalled();
  });
});
```

Create `app/auth/mfa-challenge/page.tsx`. This page has no `factorId` from the URL (the redirect from `callback/route.ts` only carries `next`) — it must first list the signed-in user's own factors client-side to find the one to challenge:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function MfaChallengePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get('next') ?? '/home';
  const [code, setCode] = useState('');
  const [factorId, setFactorId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch('/api/settings/mfa/factors')
      .then((res) => res.json())
      .then((data) => setFactorId(data.factorId ?? null))
      .catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setSubmitting(true);
    setError(null);
    const res = await fetch('/api/settings/mfa/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ factorId, code }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Something went wrong. Please try again.');
      setSubmitting(false);
      return;
    }
    router.push(next);
  }

  return (
    <main className="mx-auto flex max-w-sm flex-col gap-4 px-6 py-16">
      <h1 className="text-2xl font-bold text-gray-900">Enter your verification code</h1>
      <p className="text-gray-600">Open your authenticator app and enter the current 6-digit code.</p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label htmlFor="mfa-code" className="text-sm font-medium text-gray-700">
          Verification code
        </label>
        <input
          id="mfa-code"
          type="text"
          inputMode="numeric"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="rounded-lg border border-gray-300 px-4 py-2"
        />
        <button
          type="submit"
          disabled={submitting || !factorId}
          className="rounded-full bg-indigo-600 px-6 py-3 font-semibold text-white disabled:opacity-50"
        >
          Verify
        </button>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
      </form>
    </main>
  );
}
```

This introduces one new tiny endpoint this task must also add — `GET /api/settings/mfa/factors`, returning `{ factorId: string | null }` for the signed-in user's own verified TOTP factor (there is at most one, since a user only ever enrolls once via Task 7's flow before this page is reachable):

```ts
// app/api/settings/mfa/factors/route.ts
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.mfa.listFactors();
  const verified = (data?.totp ?? []).find((factor) => factor.status === 'verified');
  return NextResponse.json({ factorId: verified?.id ?? null });
}
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npx vitest run tests/unit/app/auth/mfa-challenge/page.test.tsx tests/unit/lib/auth/callback.test.ts`
Expected: PASS

- [ ] **Step 10: Run the full suite and typecheck**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS

- [ ] **Step 11: Commit**

```bash
git add lib/auth/callback.ts app/auth/callback/route.ts "app/auth/mfa-challenge/page.tsx" app/api/settings/mfa/factors/route.ts tests/unit/lib/auth/callback.test.ts "tests/unit/app/auth/mfa-challenge/page.test.tsx"
git commit -m "feat(settings): enforce MFA challenge after magic-link sign-in"
```

---

### Task 10: Two-factor frontend in Settings

**Files:**
- Modify: `app/settings/page.tsx`
- Test: `tests/unit/app/settings/page.test.tsx`

**Interfaces:**
- Consumes: `POST /api/settings/mfa/enroll` (Task 7), `POST /api/settings/mfa/verify` (Task 8), `POST /api/settings/mfa/disable` (Task 8), `GET /api/settings/mfa/factors` (Task 9).
- Produces: nothing further downstream.

- [ ] **Step 1: Write the failing test**

Replace the existing `it('toggles two-factor authentication locally ...', ...)` test in `tests/unit/app/settings/page.test.tsx` with:

```ts
it('enrolls and verifies two-factor authentication for real', async () => {
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    if (url === '/api/session') return Promise.resolve({ status: 200, json: async () => ({ email: 'creator@example.com' }) });
    if (url === '/api/settings/platforms') return Promise.resolve({ ok: true, json: async () => ({ tiktok: false, instagram: false, youtube: false }) });
    if (url === '/api/settings/mfa/factors') return Promise.resolve({ ok: true, json: async () => ({ factorId: null }) });
    if (url === '/api/settings/mfa/enroll') {
      return Promise.resolve({ ok: true, json: async () => ({ factorId: 'factor-1', qrCode: '<svg></svg>', secret: 'ABC123' }) });
    }
    if (url === '/api/settings/mfa/verify') return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
  vi.stubGlobal('fetch', fetchMock);

  render(<SettingsPage />);
  fireEvent.click(await screen.findByRole('switch', { name: 'Two-factor authentication' }));

  await waitFor(() => expect(screen.getByLabelText(/verification code/i)).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText(/verification code/i), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: /confirm/i }));

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/settings/mfa/verify',
      expect.objectContaining({ body: JSON.stringify({ factorId: 'factor-1', code: '123456' }) })
    )
  );
  expect(await screen.findByRole('switch', { name: 'Two-factor authentication' })).toHaveAttribute('aria-checked', 'true');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/app/settings/page.test.tsx`
Expected: FAIL — the Switch still just flips local state with no enroll/verify flow.

- [ ] **Step 3: Implement**

In `app/settings/page.tsx`, replace the local-only `twoFactor` boolean with a small state machine and real calls. Replace the `twoFactor` `useState` and add:

```ts
const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
const [mfaEnrolling, setMfaEnrolling] = useState<{ factorId: string; qrCode: string; secret: string } | null>(null);
const [mfaCode, setMfaCode] = useState('');
const [mfaError, setMfaError] = useState<string | null>(null);
```

Add, alongside the platforms bootstrap `useEffect` from Task 4:

```ts
useEffect(() => {
  if (state.status !== 'loaded') return;
  fetch('/api/settings/mfa/factors')
    .then((res) => res.json())
    .then((data) => setMfaFactorId(data.factorId ?? null))
    .catch(() => {});
}, [state.status]);

async function startMfaEnroll() {
  const res = await fetch('/api/settings/mfa/enroll', { method: 'POST' });
  const data = await res.json();
  if (res.ok) setMfaEnrolling(data);
}

async function confirmMfaEnroll() {
  if (!mfaEnrolling) return;
  setMfaError(null);
  const res = await fetch('/api/settings/mfa/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ factorId: mfaEnrolling.factorId, code: mfaCode }),
  });
  const data = await res.json();
  if (!res.ok) {
    setMfaError(data.error ?? 'Something went wrong.');
    return;
  }
  setMfaFactorId(mfaEnrolling.factorId);
  setMfaEnrolling(null);
  setMfaCode('');
}

async function disableMfa() {
  if (!mfaFactorId) return;
  setMfaError(null);
  const res = await fetch('/api/settings/mfa/disable', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ factorId: mfaFactorId, code: mfaCode }),
  });
  const data = await res.json();
  if (!res.ok) {
    setMfaError(data.error ?? 'Something went wrong.');
    return;
  }
  setMfaFactorId(null);
  setMfaCode('');
}
```

Replace the two-factor block in the Security `<section>`:

```tsx
<div className="flex items-center justify-between gap-4">
  <div className="flex min-w-0 flex-col gap-0.5">
    <span className="text-sm font-semibold text-gray-700">Two-factor authentication</span>
    <span className="text-[13px] leading-[1.45] text-gray-500">
      {mfaFactorId ? 'Enabled — codes via your authenticator app.' : 'Add a second step at sign-in.'}
    </span>
  </div>
  <Switch
    checked={Boolean(mfaFactorId)}
    onChange={() => (mfaFactorId ? setMfaEnrolling({ factorId: mfaFactorId, qrCode: '', secret: '' }) : startMfaEnroll())}
    label="Two-factor authentication"
  />
</div>
{mfaEnrolling && (
  <div className="flex flex-col gap-3 rounded-xl border border-[#eeeef2] bg-[#fafafb] p-4">
    {mfaEnrolling.qrCode && (
      <>
        <p className="text-sm text-gray-700">Scan this code in your authenticator app:</p>
        <div dangerouslySetInnerHTML={{ __html: mfaEnrolling.qrCode }} />
        <p className="text-xs text-gray-500">Or enter this key manually: {mfaEnrolling.secret}</p>
      </>
    )}
    <label htmlFor="mfa-confirm-code" className="text-sm font-medium text-gray-700">
      Verification code
    </label>
    <input
      id="mfa-confirm-code"
      type="text"
      inputMode="numeric"
      value={mfaCode}
      onChange={(e) => setMfaCode(e.target.value)}
      className="rounded-lg border border-gray-300 px-4 py-2"
    />
    <div className="flex gap-2">
      <button
        type="button"
        onClick={mfaFactorId === mfaEnrolling.factorId ? disableMfa : confirmMfaEnroll}
        className="rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white"
      >
        Confirm
      </button>
      <button
        type="button"
        onClick={() => {
          setMfaEnrolling(null);
          setMfaCode('');
          setMfaError(null);
        }}
        className="rounded-full border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700"
      >
        Cancel
      </button>
    </div>
    {mfaError && (
      <p role="alert" className="text-sm text-red-600">
        {mfaError}
      </p>
    )}
  </div>
)}
```

Update the top Preview banner one last time to drop "two-factor" from the not-saved list. Notifications is not yet real (that's Task 12) so it stays in the not-saved clause here:

```tsx
<Banner variant="info" label="Preview">
  This page previews the redesigned Settings screen. Password and notifications aren&apos;t saved yet. Profile
  details, two-factor authentication, connected platforms, locale, billing, and sign out work normally.
</Banner>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/app/settings/page.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/settings/page.tsx tests/unit/app/settings/page.test.tsx
git commit -m "feat(settings): wire real two-factor enroll/verify/disable"
```

---

### Task 11: Notification preferences migration

**Files:**
- Create: `supabase/migrations/20260930000002_create_notification_preferences.sql`
- Modify: `lib/supabase/types.ts`
- Test: `tests/unit/supabase/migrations.test.ts`

**Interfaces:**
- Produces: `public.notification_preferences` table (one row per profile, backfilled from `digest_email_opt_in`, auto-created for new signups going forward), consumed by Task 12 and Task 13.

- [ ] **Step 1: Write the failing migration test**

Add to `tests/unit/supabase/migrations.test.ts`:

```ts
it('includes a notification_preferences table migration with a backfill from digest_email_opt_in', () => {
  const sql = readMigrationContaining('create_notification_preferences');
  expect(sql).toContain('create table public.notification_preferences');
  expect(sql).toContain('profile_id uuid primary key references public.profiles(id) on delete cascade');
  expect(sql).toContain('weekly_recap_ready boolean not null default true');
  expect(sql).toContain('new_content_ideas_ready boolean not null default true');
  expect(sql).toContain('diagnostic_finished boolean not null default true');
  expect(sql).toContain('product_marketing boolean not null default false');
  expect(sql).toContain('payment_billing_alerts boolean not null default true');
  expect(sql).toContain('insert into public.notification_preferences');
  expect(sql).toContain('digest_email_opt_in');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/supabase/migrations.test.ts`
Expected: FAIL with `No migration file matching "create_notification_preferences"`

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260930000002_create_notification_preferences.sql`:

```sql
create table public.notification_preferences (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  weekly_recap_ready boolean not null default true,
  new_content_ideas_ready boolean not null default true,
  diagnostic_finished boolean not null default true,
  product_marketing boolean not null default false,
  payment_billing_alerts boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.notification_preferences enable row level security;

create policy "Notification preferences are viewable by owner"
  on public.notification_preferences for select
  using ((select auth.uid()) = profile_id);

-- No client-facing insert/update policy: writes happen through
-- PATCH /api/settings/notifications via the service-role client only.

-- Backfill: every existing profile's weekly-digest opt-in maps to the
-- closest new toggle, so nobody's existing subscription silently resets.
insert into public.notification_preferences (profile_id, new_content_ideas_ready)
select id, digest_email_opt_in from public.profiles
on conflict (profile_id) do nothing;

-- Every new signup also gets a default preferences row going forward,
-- alongside its profiles row. Redefines the existing trigger function
-- rather than adding a second trigger, so both inserts stay one
-- transaction under the same on_auth_user_created trigger.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  insert into public.notification_preferences (profile_id)
  values (new.id);
  return new;
end;
$$;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/supabase/migrations.test.ts`
Expected: PASS

- [ ] **Step 5: Update `lib/supabase/types.ts`**

Add a new entry to `Database['public']['Tables']`, alongside `subscriptions`:

```ts
notification_preferences: {
  Row: {
    profile_id: string;
    weekly_recap_ready: boolean;
    new_content_ideas_ready: boolean;
    diagnostic_finished: boolean;
    product_marketing: boolean;
    payment_billing_alerts: boolean;
    updated_at: string;
  };
  Insert: {
    profile_id: string;
    weekly_recap_ready?: boolean;
    new_content_ideas_ready?: boolean;
    diagnostic_finished?: boolean;
    product_marketing?: boolean;
    payment_billing_alerts?: boolean;
    updated_at?: string;
  };
  Update: Partial<Database['public']['Tables']['notification_preferences']['Insert']>;
  Relationships: [];
};
```

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260930000002_create_notification_preferences.sql lib/supabase/types.ts tests/unit/supabase/migrations.test.ts
git commit -m "feat(settings): add notification_preferences table"
```

---

### Task 12: Notification preferences endpoint and frontend

**Files:**
- Create: `lib/settings/notifications-handler.ts`
- Create: `app/api/settings/notifications/route.ts`
- Modify: `app/settings/page.tsx`
- Test: `tests/unit/lib/settings/notifications-handler.test.ts`
- Test: `tests/unit/app/settings/page.test.tsx`

**Interfaces:**
- Consumes: `notification_preferences` table (Task 11).
- Produces: `handleUpdateNotifications(deps, context)`, `PATCH /api/settings/notifications`.

- [ ] **Step 1: Write the failing handler tests**

Create `tests/unit/lib/settings/notifications-handler.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { handleUpdateNotifications, type UpdateNotificationsDeps } from '@/lib/settings/notifications-handler';

describe('handleUpdateNotifications', () => {
  it('returns 401 when not signed in', async () => {
    const result = await handleUpdateNotifications({ savePreferences: vi.fn() }, { profileId: null, updates: {} });
    expect(result.status).toBe(401);
  });

  it('saves a partial update of known keys only', async () => {
    const savePreferences = vi.fn().mockResolvedValue(undefined);
    const result = await handleUpdateNotifications(
      { savePreferences },
      { profileId: 'profile-1', updates: { weeklyRecapReady: false, productMarketing: true } }
    );
    expect(result.status).toBe(200);
    expect(savePreferences).toHaveBeenCalledWith('profile-1', { weekly_recap_ready: false, product_marketing: true });
  });

  it('ignores unrecognized keys rather than saving them', async () => {
    const savePreferences = vi.fn().mockResolvedValue(undefined);
    const result = await handleUpdateNotifications(
      { savePreferences },
      { profileId: 'profile-1', updates: { notARealKey: true } as never }
    );
    expect(result.status).toBe(200);
    expect(savePreferences).toHaveBeenCalledWith('profile-1', {});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/settings/notifications-handler.test.ts`
Expected: FAIL with `Cannot find module '@/lib/settings/notifications-handler'`

- [ ] **Step 3: Implement**

Create `lib/settings/notifications-handler.ts`:

```ts
export interface NotificationUpdates {
  weeklyRecapReady?: boolean;
  newContentIdeasReady?: boolean;
  diagnosticFinished?: boolean;
  productMarketing?: boolean;
  paymentBillingAlerts?: boolean;
}

const KEY_MAP: Record<keyof NotificationUpdates, string> = {
  weeklyRecapReady: 'weekly_recap_ready',
  newContentIdeasReady: 'new_content_ideas_ready',
  diagnosticFinished: 'diagnostic_finished',
  productMarketing: 'product_marketing',
  paymentBillingAlerts: 'payment_billing_alerts',
};

export interface UpdateNotificationsDeps {
  savePreferences: (profileId: string, columns: Record<string, boolean>) => Promise<void>;
}

export interface UpdateNotificationsContext {
  profileId: string | null;
  updates: NotificationUpdates;
}

export interface UpdateNotificationsResult {
  status: number;
  body: Record<string, unknown>;
}

export async function handleUpdateNotifications(
  deps: UpdateNotificationsDeps,
  context: UpdateNotificationsContext
): Promise<UpdateNotificationsResult> {
  if (!context.profileId) {
    return { status: 401, body: { error: 'You must be signed in.' } };
  }

  const columns: Record<string, boolean> = {};
  for (const key of Object.keys(KEY_MAP) as Array<keyof NotificationUpdates>) {
    const value = context.updates[key];
    if (typeof value === 'boolean') {
      columns[KEY_MAP[key]] = value;
    }
  }

  await deps.savePreferences(context.profileId, columns);
  return { status: 200, body: { ok: true } };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/lib/settings/notifications-handler.test.ts`
Expected: PASS

- [ ] **Step 5: Create the route**

Create `app/api/settings/notifications/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { handleUpdateNotifications } from '@/lib/settings/notifications-handler';

export async function PATCH(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const serviceClient = createSupabaseServiceRoleClient();
  const body = await request.json().catch(() => ({}));

  const result = await handleUpdateNotifications(
    {
      savePreferences: async (profileId, columns) => {
        const { error } = await serviceClient
          .from('notification_preferences')
          .update({ ...columns, updated_at: new Date().toISOString() })
          .eq('profile_id', profileId);
        if (error) {
          throw new Error(`Failed to save notification preferences: ${error.message}`);
        }
      },
    },
    { profileId: user?.id ?? null, updates: body }
  );

  return NextResponse.json(result.body, { status: result.status });
}
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 7: Wire the frontend and write its test**

In `app/settings/page.tsx`, replace the `notifOn` `useState`'s local-only `onChange` in the Notifications `<section>`'s `.map(...)` with a real save call. First, map each `notif.key` to the camelCase update key the API expects — add near `NOTIF_META`:

```ts
const NOTIF_UPDATE_KEY: Record<NotifKey, string> = {
  recap: 'weeklyRecapReady',
  ideas: 'newContentIdeasReady',
  diagnostic: 'diagnosticFinished',
  product: 'productMarketing',
  billing: 'paymentBillingAlerts',
};
```

Replace the `Switch`'s `onChange`:

```tsx
<Switch
  checked={notifOn[notif.key]}
  onChange={() => {
    const next = !notifOn[notif.key];
    setNotifOn((prev) => ({ ...prev, [notif.key]: next }));
    fetch('/api/settings/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [NOTIF_UPDATE_KEY[notif.key]]: next }),
    });
  }}
  label={notif.label}
/>
```

Also fetch the real initial values on load instead of the hardcoded local defaults — add to the platforms/mfa bootstrap `useEffect` group:

```ts
useEffect(() => {
  if (state.status !== 'loaded') return;
  fetch('/api/settings/notifications-status') // see note below
}, [state.status]);
```

There is no `GET /api/settings/notifications-status` endpoint — reuse `GET /api/settings/platforms`'s pattern by adding a small `GET` handler to `app/api/settings/notifications/route.ts` in this same step, alongside its existing `PATCH`:

```ts
export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 });
  }
  const serviceClient = createSupabaseServiceRoleClient();
  const { data } = await serviceClient
    .from('notification_preferences')
    .select('weekly_recap_ready, new_content_ideas_ready, diagnostic_finished, product_marketing, payment_billing_alerts')
    .eq('profile_id', user.id)
    .single();

  return NextResponse.json({
    recap: data?.weekly_recap_ready ?? true,
    ideas: data?.new_content_ideas_ready ?? true,
    diagnostic: data?.diagnostic_finished ?? true,
    product: data?.product_marketing ?? false,
    billing: data?.payment_billing_alerts ?? true,
  });
}
```

Then the frontend `useEffect` becomes:

```ts
useEffect(() => {
  if (state.status !== 'loaded') return;
  fetch('/api/settings/notifications')
    .then((res) => res.json())
    .then((data) => setNotifOn(data))
    .catch(() => {});
}, [state.status]);
```

Add to `tests/unit/app/settings/page.test.tsx`:

```ts
it('loads real notification preferences and saves a toggle change', async () => {
  const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (url === '/api/session') return Promise.resolve({ status: 200, json: async () => ({ email: 'creator@example.com' }) });
    if (url === '/api/settings/notifications' && !init) {
      return Promise.resolve({ ok: true, json: async () => ({ recap: false, ideas: true, diagnostic: true, product: false, billing: true }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
  vi.stubGlobal('fetch', fetchMock);

  render(<SettingsPage />);
  const recapSwitch = await screen.findByRole('switch', { name: 'Weekly recap ready' });
  await waitFor(() => expect(recapSwitch).toHaveAttribute('aria-checked', 'false'));

  fireEvent.click(recapSwitch);

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/settings/notifications',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ weeklyRecapReady: true }) })
    )
  );
});
```

- [ ] **Step 8: Update the Preview banner — notifications is now real**

Notifications is the last section before account deletion to become real. Update the same top Preview banner Tasks 4/5/10 have been narrowing:

```tsx
<Banner variant="info" label="Preview">
  This page previews the redesigned Settings screen. Password isn&apos;t available yet. Profile details, two-factor
  authentication, connected platforms, notifications, locale, billing, and sign out work normally.
</Banner>
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npx vitest run tests/unit/app/settings/page.test.tsx`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add lib/settings/notifications-handler.ts app/api/settings/notifications/route.ts app/settings/page.tsx tests/unit/lib/settings/notifications-handler.test.ts tests/unit/app/settings/page.test.tsx
git commit -m "feat(settings): persist notification preferences"
```

---

### Task 13: Weekly-digest cron reads the new preference column

**Files:**
- Modify: `app/api/cron/weekly-digest/route.ts`
- Test: manual verification only (this file wires a real Supabase query filter; the cron's own orchestration logic in `lib/digest/cron-handler.ts` is unchanged and already tested)

**Interfaces:**
- Consumes: `notification_preferences.new_content_ideas_ready` (Task 11).
- Produces: nothing further downstream.

- [ ] **Step 1: Update the candidate query**

In `app/api/cron/weekly-digest/route.ts`'s `getOptedInCandidates`, replace the `profiles` query's filter and select. The inner join filters the parent `profiles` rows to only those with a matching, `true`-valued related row — every profile has exactly one `notification_preferences` row after Task 11's backfill and trigger, so this inner join never silently drops a profile for a missing row:

```ts
const { data, error } = await serviceClient
  .from('profiles')
  .select('id, niche, digest_last_sent_at, notification_preferences!inner(new_content_ideas_ready)')
  .eq('notification_preferences.new_content_ideas_ready', true)
  .not('niche', 'is', null)
  .order('digest_last_sent_at', { ascending: true, nullsFirst: true })
  .limit(limit);
```

(`digest_last_sent_at` needs to be explicitly selected now since the select list changed from `'id, niche'` to include the join — confirm the `.order(...)` call below still resolves against a selected column; if the existing code already selected it implicitly via `select('id, niche')` not including it, check the actual current select list in this file before editing, since `.order` in PostgREST does not require the ordered column to be in `select()` — only add it to `select()` if the current code's usage further down in this same function reads `row.digest_last_sent_at` directly, which it does not per the code already shown in this plan's research. Leave the rest of the function, including the per-row `hasActiveSubscription` check and `auth.admin.getUserById` lookup, exactly as they are.)

Also add a one-line comment marking the old column deprecated, on `profiles.digest_email_opt_in`'s definition — do not drop the column in this task (§6 of the spec: dropped in a later migration once nothing reads it):

In `supabase/migrations/20260815010000_add_weekly_digest_email_fields.sql`, this is a past migration and must not be edited (migrations are append-only history) — instead, note the deprecation in `lib/supabase/types.ts` as a comment above `digest_email_opt_in` in the `profiles` `Row`/`Insert` types: `// deprecated: superseded by notification_preferences.new_content_ideas_ready (see 2026-09-30-settings-backend-design.md §6)`.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Manual verification**

This route has no dedicated unit test file in this codebase (route handlers here are wiring, not logic — see the established convention). Verify by reading the diff carefully against `lib/digest/cron-handler.test.ts`'s existing `DigestCandidate` shape (`{ profileId, email, niche }`) to confirm this task's changed `select`/`.eq` still ultimately produces objects matching that shape unchanged — the `notification_preferences` join column is used only for filtering, never mapped into the returned `DigestCandidate`.

- [ ] **Step 4: Commit**

```bash
git add app/api/cron/weekly-digest/route.ts lib/supabase/types.ts
git commit -m "feat(settings): weekly-digest cron reads notification_preferences"
```

---

### Task 14: Payment-failure email on past-due transition

**Files:**
- Create: `lib/billing/payment-alerts.ts`
- Modify: `app/api/webhooks/stripe/route.ts`
- Test: `tests/unit/lib/billing/payment-alerts.test.ts`

**Interfaces:**
- Consumes: `notification_preferences.payment_billing_alerts` (Task 11), `EmailClient` (existing, `lib/integrations/resend.ts`).
- Produces: `shouldSendPastDueAlert(previousStatus, newStatus): boolean`, consumed only by this task's own route wiring.

This task deliberately does **not** modify `lib/billing/webhook-handler.ts` or its existing, passing tests — the transition-detection logic is a small new pure function, and the "read old status, update, maybe send" sequencing lives entirely inside `app/api/webhooks/stripe/route.ts`'s own `updateSubscriptionFromStripe` dependency closure, which already does a `select`-then-`update` round trip.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/lib/billing/payment-alerts.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { shouldSendPastDueAlert } from '@/lib/billing/payment-alerts';

describe('shouldSendPastDueAlert', () => {
  it('returns true when transitioning into past_due from active', () => {
    expect(shouldSendPastDueAlert('active', 'past_due')).toBe(true);
  });

  it('returns false when already past_due (avoids re-sending on webhook redelivery)', () => {
    expect(shouldSendPastDueAlert('past_due', 'past_due')).toBe(false);
  });

  it('returns false when the new status is not past_due', () => {
    expect(shouldSendPastDueAlert('active', 'active')).toBe(false);
    expect(shouldSendPastDueAlert(null, 'active')).toBe(false);
  });

  it('returns true when there was no previous row at all', () => {
    expect(shouldSendPastDueAlert(null, 'past_due')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/billing/payment-alerts.test.ts`
Expected: FAIL with `Cannot find module '@/lib/billing/payment-alerts'`

- [ ] **Step 3: Implement**

Create `lib/billing/payment-alerts.ts`:

```ts
export function shouldSendPastDueAlert(previousStatus: string | null, newStatus: string): boolean {
  return newStatus === 'past_due' && previousStatus !== 'past_due';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/billing/payment-alerts.test.ts`
Expected: PASS

- [ ] **Step 5: Wire it into the webhook route**

In `app/api/webhooks/stripe/route.ts`, modify the `updateSubscriptionFromStripe` dependency closure to read the current status first, and send the alert after a successful update when the transition warrants it:

```ts
import { shouldSendPastDueAlert } from '@/lib/billing/payment-alerts';
import { createResendEmailClient } from '@/lib/integrations/resend';

// ...inside the handler, before calling handleStripeWebhookEvent:
const emailClient = createResendEmailClient(process.env.RESEND_API_KEY ?? '', process.env.DIGEST_FROM_EMAIL ?? '');

async function sendPastDueAlertIfOptedIn(stripeCustomerId: string): Promise<void> {
  const { data: sub } = await serviceClient
    .from('subscriptions')
    .select('profile_id')
    .eq('stripe_customer_id', stripeCustomerId)
    .maybeSingle();
  if (!sub) return;

  const { data: prefs } = await serviceClient
    .from('notification_preferences')
    .select('payment_billing_alerts')
    .eq('profile_id', sub.profile_id)
    .maybeSingle();
  if (prefs?.payment_billing_alerts === false) return;

  // profiles.email is client-writable and not authoritative — the verified
  // address lives in Supabase Auth. Same hazard/fix as the weekly-digest
  // and checkout routes.
  const { data: userData, error: userError } = await serviceClient.auth.admin.getUserById(sub.profile_id);
  if (userError || !userData?.user?.email) return;

  await emailClient.sendEmail({
    to: userData.user.email,
    subject: "We couldn't process your last payment",
    html: '<p>We were unable to process your last payment for Creator Dashboard. Please update your card in Billing to keep your subscription active.</p>',
  });
}
```

Update `updateSubscriptionFromStripe`'s body:

```ts
updateSubscriptionFromStripe: async ({ stripeCustomerId, stripeSubscriptionId, status, currentPeriodEnd, cancelAtPeriodEnd }) => {
  const { data: existing } = await serviceClient
    .from('subscriptions')
    .select('status')
    .eq('stripe_customer_id', stripeCustomerId)
    .maybeSingle();

  const { data, error } = await serviceClient
    .from('subscriptions')
    .update({
      stripe_subscription_id: stripeSubscriptionId,
      status,
      current_period_end: currentPeriodEnd,
      cancel_at_period_end: cancelAtPeriodEnd,
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_customer_id', stripeCustomerId)
    .select();
  if (error) {
    throw new Error(`Failed to sync subscription: ${error.message}`);
  }
  if (!data || data.length === 0) {
    throw new Error(`No subscription row found for Stripe customer ${stripeCustomerId}`);
  }

  if (shouldSendPastDueAlert(existing?.status ?? null, status)) {
    await sendPastDueAlertIfOptedIn(stripeCustomerId);
  }
},
```

(Keep the rest of the file, including `markSubscriptionCanceled` and the outer try/catch, unchanged.)

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 7: Run the full suite**

Run: `npx vitest run tests/unit/lib/billing`
Expected: PASS — the existing `webhook-handler.test.ts` suite is untouched by this task and should be unaffected, since none of its changes happened in `lib/billing/webhook-handler.ts` itself.

- [ ] **Step 8: Commit**

```bash
git add lib/billing/payment-alerts.ts app/api/webhooks/stripe/route.ts tests/unit/lib/billing/payment-alerts.test.ts
git commit -m "feat(settings): send a payment-failure email on past-due transition"
```

---

### Task 15: Account-deletion migration and Stripe cancellation

**Files:**
- Create: `supabase/migrations/20260930000003_add_scheduled_deletion_to_profiles.sql`
- Modify: `lib/supabase/types.ts`
- Modify: `lib/integrations/stripe.ts`
- Modify: `tests/fakes/stripe.fake.ts`
- Test: `tests/unit/supabase/migrations.test.ts`
- Test: `tests/unit/lib/integrations/stripe.test.ts`

**Interfaces:**
- Produces: `profiles.scheduled_deletion_at` column, `StripeClient.cancelSubscription(subscriptionId)`, consumed by Task 16.

- [ ] **Step 1: Write the failing migration test**

Add to `tests/unit/supabase/migrations.test.ts`:

```ts
it('includes a migration adding scheduled_deletion_at to profiles', () => {
  const sql = readMigrationContaining('add_scheduled_deletion_to_profiles');
  expect(sql).toContain('add column scheduled_deletion_at timestamptz');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/supabase/migrations.test.ts`
Expected: FAIL with `No migration file matching "add_scheduled_deletion_to_profiles"`

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260930000003_add_scheduled_deletion_to_profiles.sql`:

```sql
alter table public.profiles
  add column scheduled_deletion_at timestamptz;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/supabase/migrations.test.ts`
Expected: PASS

- [ ] **Step 5: Update `lib/supabase/types.ts`**

Add to `profiles`' `Row`: `scheduled_deletion_at: string | null;`
Add to `profiles`' `Insert`: `scheduled_deletion_at?: string | null;`

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Write the failing Stripe client test**

Find the existing test file for `lib/integrations/stripe.ts` (check `tests/unit/lib/integrations/stripe.test.ts`) and add, following its existing pattern for asserting request shape against the fetch mock:

```ts
describe('cancelSubscription', () => {
  it('sends a DELETE request to the subscription endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'sub_1', status: 'canceled' }) });
    vi.stubGlobal('fetch', fetchMock);

    const client = createStripeClient('sk_test_123');
    await client.cancelSubscription('sub_1');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.stripe.com/v1/subscriptions/sub_1',
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('throws with the Stripe error message on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: { message: 'No such subscription' } }) })
    );
    const client = createStripeClient('sk_test_123');
    await expect(client.cancelSubscription('sub_bad')).rejects.toThrow('No such subscription');
  });
});
```

(Add `afterEach(() => vi.unstubAllGlobals())` to this describe block if the file's existing top-level `afterEach` doesn't already cover it — check the file first.)

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/integrations/stripe.test.ts`
Expected: FAIL — `cancelSubscription` is not a function on the returned client.

- [ ] **Step 8: Implement**

In `lib/integrations/stripe.ts`, add to the `StripeClient` interface:

```ts
cancelSubscription(subscriptionId: string): Promise<void>;
```

The existing `stripeRequest` helper is POST-only internally (`method: 'POST'` is hardcoded). Add a second small helper rather than widening `stripeRequest`'s signature (keeps every existing call site untouched):

```ts
async function stripeDelete(path: string, secretKey: string): Promise<void> {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  if (!response.ok) {
    const data = await response.json();
    const message = (data as { error?: { message?: string } }).error?.message ?? `Stripe API request failed with status ${response.status}`;
    throw new Error(message);
  }
}
```

Add to the object returned by `createStripeClient`:

```ts
async cancelSubscription(subscriptionId) {
  await stripeDelete(`subscriptions/${subscriptionId}`, secretKey);
},
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npx vitest run tests/unit/lib/integrations/stripe.test.ts`
Expected: PASS

- [ ] **Step 10: Update the fake**

In `tests/fakes/stripe.fake.ts`, add `cancelSubscription: async () => {},` to the returned object.

- [ ] **Step 11: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 12: Commit**

```bash
git add supabase/migrations/20260930000003_add_scheduled_deletion_to_profiles.sql lib/supabase/types.ts lib/integrations/stripe.ts tests/fakes/stripe.fake.ts tests/unit/supabase/migrations.test.ts tests/unit/lib/integrations/stripe.test.ts
git commit -m "feat(settings): add scheduled_deletion_at column and Stripe cancelSubscription"
```

---

### Task 16: Account-deletion request handler and route

**Files:**
- Create: `lib/settings/delete-account-handler.ts`
- Create: `app/api/settings/delete-account/route.ts`
- Test: `tests/unit/lib/settings/delete-account-handler.test.ts`

**Interfaces:**
- Consumes: `checkAndRecordRateLimit` (existing), `StripeClient.cancelSubscription` (Task 15).
- Produces: `handleDeleteAccountRequest(deps, context)`, `POST /api/settings/delete-account`, consumed by Task 20's frontend.

- [ ] **Step 1: Write the failing handler tests**

Create `tests/unit/lib/settings/delete-account-handler.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { handleDeleteAccountRequest, type DeleteAccountDeps } from '@/lib/settings/delete-account-handler';
import { createInMemoryRateLimitStore } from '@/tests/fakes/rate-limit-store.fake';

function makeDeps(overrides: Partial<DeleteAccountDeps> = {}): DeleteAccountDeps {
  return {
    rateLimitStore: createInMemoryRateLimitStore(),
    getActiveStripeSubscriptionId: vi.fn().mockResolvedValue(null),
    cancelStripeSubscription: vi.fn().mockResolvedValue(undefined),
    scheduleDeletion: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('handleDeleteAccountRequest', () => {
  it('returns 401 when not signed in', async () => {
    const result = await handleDeleteAccountRequest(makeDeps(), { profileId: null });
    expect(result.status).toBe(401);
  });

  it('schedules deletion 14 days out and signs out, when there is no active subscription', async () => {
    const scheduleDeletion = vi.fn().mockResolvedValue(undefined);
    const signOut = vi.fn().mockResolvedValue(undefined);
    const cancelStripeSubscription = vi.fn();
    const now = new Date('2026-09-30T00:00:00Z');

    const result = await handleDeleteAccountRequest(
      makeDeps({ scheduleDeletion, signOut, cancelStripeSubscription }),
      { profileId: 'profile-1' },
      now
    );

    expect(result.status).toBe(200);
    expect(cancelStripeSubscription).not.toHaveBeenCalled();
    expect(scheduleDeletion).toHaveBeenCalledWith('profile-1', new Date('2026-10-14T00:00:00Z'));
    expect(signOut).toHaveBeenCalled();
  });

  it('cancels an active Stripe subscription before scheduling deletion', async () => {
    const cancelStripeSubscription = vi.fn().mockResolvedValue(undefined);
    const scheduleDeletion = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      getActiveStripeSubscriptionId: vi.fn().mockResolvedValue('sub_1'),
      cancelStripeSubscription,
      scheduleDeletion,
    });

    const result = await handleDeleteAccountRequest(deps, { profileId: 'profile-1' });

    expect(result.status).toBe(200);
    expect(cancelStripeSubscription).toHaveBeenCalledWith('sub_1');
    expect(scheduleDeletion).toHaveBeenCalled();
  });

  it('blocks the whole request if cancelling the subscription fails, without scheduling anything', async () => {
    const scheduleDeletion = vi.fn();
    const signOut = vi.fn();
    const deps = makeDeps({
      getActiveStripeSubscriptionId: vi.fn().mockResolvedValue('sub_1'),
      cancelStripeSubscription: vi.fn().mockRejectedValue(new Error('Stripe is down')),
      scheduleDeletion,
      signOut,
    });

    const result = await handleDeleteAccountRequest(deps, { profileId: 'profile-1' });

    expect(result.status).toBe(500);
    expect(scheduleDeletion).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it('rate-limits repeated deletion requests', async () => {
    const store = createInMemoryRateLimitStore();
    const deps = makeDeps({ rateLimitStore: store });
    for (let i = 0; i < 3; i++) {
      await handleDeleteAccountRequest(deps, { profileId: 'profile-1' });
    }
    const result = await handleDeleteAccountRequest(deps, { profileId: 'profile-1' });
    expect(result.status).toBe(429);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/lib/settings/delete-account-handler.test.ts`
Expected: FAIL with `Cannot find module '@/lib/settings/delete-account-handler'`

- [ ] **Step 3: Implement**

Create `lib/settings/delete-account-handler.ts`:

```ts
import { checkAndRecordRateLimit, type RateLimitStore } from '@/lib/rate-limit';

const GRACE_PERIOD_DAYS = 14;
const DELETE_REQUEST_LIMIT = 3;
const DELETE_REQUEST_WINDOW_DAYS = 1;

export interface DeleteAccountDeps {
  rateLimitStore: RateLimitStore;
  getActiveStripeSubscriptionId: (profileId: string) => Promise<string | null>;
  cancelStripeSubscription: (subscriptionId: string) => Promise<void>;
  scheduleDeletion: (profileId: string, deletionAt: Date) => Promise<void>;
  signOut: () => Promise<void>;
}

export interface DeleteAccountContext {
  profileId: string | null;
}

export interface DeleteAccountResult {
  status: number;
  body: Record<string, unknown>;
}

export async function handleDeleteAccountRequest(
  deps: DeleteAccountDeps,
  context: DeleteAccountContext,
  now: Date = new Date()
): Promise<DeleteAccountResult> {
  if (!context.profileId) {
    return { status: 401, body: { error: 'You must be signed in.' } };
  }

  const rateLimitResult = await checkAndRecordRateLimit({
    store: deps.rateLimitStore,
    profileId: context.profileId,
    ipHash: 'n/a',
    eventType: 'account_deletion_request',
    profileLimit: DELETE_REQUEST_LIMIT,
    ipLimit: Number.MAX_SAFE_INTEGER,
    windowDays: DELETE_REQUEST_WINDOW_DAYS,
  });
  if (!rateLimitResult.allowed) {
    return { status: 429, body: { error: 'Too many attempts. Please wait and try again.' } };
  }

  const activeSubscriptionId = await deps.getActiveStripeSubscriptionId(context.profileId);
  if (activeSubscriptionId) {
    try {
      await deps.cancelStripeSubscription(activeSubscriptionId);
    } catch {
      // Never schedule a deletion with a still-billing subscription behind
      // it — this is the one place in this feature a downstream failure
      // must block the primary action rather than being logged and
      // ignored. See design spec §8.
      return { status: 500, body: { error: 'Something went wrong canceling your subscription. Please try again.' } };
    }
  }

  const deletionAt = new Date(now.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
  await deps.scheduleDeletion(context.profileId, deletionAt);
  await deps.signOut();

  return { status: 200, body: { scheduledDeletionAt: deletionAt.toISOString() } };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/lib/settings/delete-account-handler.test.ts`
Expected: PASS

- [ ] **Step 5: Create the route**

Create `app/api/settings/delete-account/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { createSupabaseRateLimitStore } from '@/lib/supabase/rate-limit-store';
import { createStripeClient } from '@/lib/integrations/stripe';
import { handleDeleteAccountRequest } from '@/lib/settings/delete-account-handler';

export async function POST() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const serviceClient = createSupabaseServiceRoleClient();
  const stripeClient = createStripeClient(process.env.STRIPE_SECRET_KEY ?? '');

  const result = await handleDeleteAccountRequest(
    {
      rateLimitStore: createSupabaseRateLimitStore(serviceClient),
      getActiveStripeSubscriptionId: async (profileId) => {
        const { data } = await serviceClient
          .from('subscriptions')
          .select('stripe_subscription_id, status')
          .eq('profile_id', profileId)
          .maybeSingle();
        if (!data || !data.stripe_subscription_id) return null;
        return data.status === 'active' || data.status === 'past_due' ? data.stripe_subscription_id : null;
      },
      cancelStripeSubscription: (subscriptionId) => stripeClient.cancelSubscription(subscriptionId),
      scheduleDeletion: async (profileId, deletionAt) => {
        const { error } = await serviceClient
          .from('profiles')
          .update({ scheduled_deletion_at: deletionAt.toISOString() })
          .eq('id', profileId);
        if (error) {
          throw new Error(`Failed to schedule deletion: ${error.message}`);
        }
      },
      signOut: () => supabase.auth.signOut(),
    },
    { profileId: user?.id ?? null }
  );

  return NextResponse.json(result.body, { status: result.status });
}
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add lib/settings/delete-account-handler.ts app/api/settings/delete-account/route.ts tests/unit/lib/settings/delete-account-handler.test.ts
git commit -m "feat(settings): add account-deletion request endpoint"
```

---

### Task 17: Auto-cancel pending deletion on sign-in

**Files:**
- Modify: `app/api/session/route.ts`
- Test: `tests/unit/app/api/auth/session-route.test.ts` (create if no test file for this route already exists — check first)

**Interfaces:**
- Consumes: `profiles.scheduled_deletion_at` (Task 15).
- Produces: `GET /api/session`'s response gains an optional `justCancelledDeletion: true` field, consumed by Task 20's frontend.

This is the one route in this plan that gets logic-level unit tests directly rather than a separate `lib/` handler — `/api/session` is already a two-line pass-through with no existing handler-module split (confirmed: it's currently `supabase.auth.getUser()` + one `NextResponse.json` call, nothing to extract). Adding a small amount of real logic here is more consistent with this file's existing shape than introducing a new `lib/settings/session-handler.ts` for one conditional.

- [ ] **Step 1: Check for an existing test file**

Run: `find tests -iname "*session*route*"` — if a test file already covers `app/api/session/route.ts`, extend it in Step 3 below instead of creating a new one at the path this task assumes.

- [ ] **Step 2: Write the failing test**

Create (or extend) `tests/unit/app/api/auth/session-route.test.ts`. Since this route reads real Supabase clients directly with no injected deps, mock the module:

```ts
import { describe, it, expect, vi } from 'vitest';

const getUserMock = vi.fn();
const fromMock = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser: getUserMock } }),
  createSupabaseServiceRoleClient: () => ({ from: fromMock }),
}));

import { GET } from '@/app/api/session/route';

function mockProfileQuery(row: { scheduled_deletion_at: string | null } | null) {
  const eq = vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: row }) });
  const select = vi.fn().mockReturnValue({ eq });
  const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
  fromMock.mockReturnValue({ select, update });
  return { select, update };
}

describe('GET /api/session', () => {
  it('returns just the email when there is no pending deletion', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'profile-1', email: 'creator@example.com' } } });
    mockProfileQuery({ scheduled_deletion_at: null });

    const response = await GET();
    const body = await response.json();

    expect(body).toEqual({ email: 'creator@example.com' });
  });

  it('clears a pending deletion and flags justCancelledDeletion when one exists', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'profile-1', email: 'creator@example.com' } } });
    const { update } = mockProfileQuery({ scheduled_deletion_at: '2026-10-14T00:00:00Z' });

    const response = await GET();
    const body = await response.json();

    expect(body).toEqual({ email: 'creator@example.com', justCancelledDeletion: true });
    expect(update).toHaveBeenCalledWith({ scheduled_deletion_at: null });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/unit/app/api/auth/session-route.test.ts`
Expected: FAIL — the route doesn't check or clear `scheduled_deletion_at` yet.

- [ ] **Step 4: Implement**

Replace `app/api/session/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !user.email) {
    return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 });
  }

  const serviceClient = createSupabaseServiceRoleClient();
  const { data: profile } = await serviceClient
    .from('profiles')
    .select('scheduled_deletion_at')
    .eq('id', user.id)
    .single();

  if (profile?.scheduled_deletion_at) {
    await serviceClient.from('profiles').update({ scheduled_deletion_at: null }).eq('id', user.id);
    return NextResponse.json({ email: user.email, justCancelledDeletion: true });
  }

  return NextResponse.json({ email: user.email });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/app/api/auth/session-route.test.ts`
Expected: PASS

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run`
Expected: PASS — `AppNav`'s own `fetch('/api/session')` call and every page that mocks it should be unaffected, since the response shape only gains an optional extra field.

- [ ] **Step 7: Commit**

```bash
git add app/api/session/route.ts tests/unit/app/api/auth/session-route.test.ts
git commit -m "feat(settings): auto-cancel pending account deletion on sign-in"
```

---

### Task 18: Scheduled-deletion cron

**Files:**
- Create: `app/api/cron/delete-scheduled-accounts/route.ts`
- Test: manual verification only, matching Task 13's convention (route wiring, no injected-deps handler needed for a single-query cron loop)

**Interfaces:**
- Consumes: `profiles.scheduled_deletion_at` (Task 15), `CRON_SECRET` env var (existing pattern from `weekly-digest`/`warroom`).
- Produces: nothing further downstream — this is the terminal step of the deletion lifecycle.

- [ ] **Step 1: Implement**

Create `app/api/cron/delete-scheduled-accounts/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';

export const maxDuration = 300;

function isAuthorizedCronRequest(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return request.headers.get('authorization') === `Bearer ${expected}`;
}

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const serviceClient = createSupabaseServiceRoleClient();
  const { data: dueProfiles, error } = await serviceClient
    .from('profiles')
    .select('id')
    .not('scheduled_deletion_at', 'is', null)
    .lt('scheduled_deletion_at', new Date().toISOString());

  if (error) {
    console.error('Failed to fetch profiles due for deletion:', error.message);
    return NextResponse.json({ error: 'Failed to fetch profiles due for deletion' }, { status: 500 });
  }

  const deleted: string[] = [];
  const failed: string[] = [];
  for (const profile of dueProfiles ?? []) {
    // The on-delete-cascade chain from auth.users -> profiles -> every
    // feature table's own profile_id FK deletes everything else for free —
    // no per-table cleanup needed here. See design spec §7.
    const { error: deleteError } = await serviceClient.auth.admin.deleteUser(profile.id);
    if (deleteError) {
      console.error(`Failed to delete profile ${profile.id}:`, deleteError.message);
      failed.push(profile.id);
      continue;
    }
    deleted.push(profile.id);
  }

  return NextResponse.json({ deleted: deleted.length, failed: failed.length });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Register the cron schedule**

The repo root's `vercel.json` currently registers only the `warroom` cron (`weekly-digest` is scheduled some other way outside this file — do not touch its entry or investigate further, out of scope here). Add this task's cron alongside it:

```json
{
  "crons": [
    { "path": "/api/cron/warroom", "schedule": "0 0 * * *" },
    { "path": "/api/cron/delete-scheduled-accounts", "schedule": "0 6 * * *" }
  ]
}
```

- [ ] **Step 4: Commit**

```bash
git add app/api/cron/delete-scheduled-accounts/route.ts vercel.json
git commit -m "feat(settings): add scheduled-account-deletion cron"
```

---

### Task 19: Account-deletion frontend in Settings

**Files:**
- Modify: `app/settings/page.tsx`
- Test: `tests/unit/app/settings/page.test.tsx`

**Interfaces:**
- Consumes: `POST /api/settings/delete-account` (Task 16), `justCancelledDeletion`/`scheduledDeletionAt` flags (Task 17 — note `GET /api/session` only returns `justCancelledDeletion`, not an ongoing `scheduledDeletionAt`; Settings needs its own way to know a deletion is currently pending on page load, addressed below).
- Produces: nothing further downstream.

Task 17's `/api/session` only reports a deletion being *cancelled just now* (a one-time transition), not "is one currently pending" on an ordinary page load where the grace period hasn't been touched. Since Settings is the only page that needs to show an ongoing countdown, extend `GET /api/settings/platforms` — already this page's own extra bootstrap call — is the wrong place (unrelated concern). Instead, this task adds `scheduledDeletionAt` to the response of a route already scoped to profile-level settings data: extend `GET /api/settings/notifications` (Task 12) is also the wrong shape. The correct fix is a small dedicated field on the Settings page's own session-derived state — add it to the existing `/api/session` response instead, since Task 17 already changed that route and AppNav already calls it on every page (harmless extra field for pages that ignore it):

- [ ] **Step 1: Extend `GET /api/session` with `scheduledDeletionAt`**

In `app/api/session/route.ts` (from Task 17), change the `profile` select to also fetch the value when still pending, and include it in the plain response branch:

```ts
const { data: profile } = await serviceClient
  .from('profiles')
  .select('scheduled_deletion_at')
  .eq('id', user.id)
  .single();

if (profile?.scheduled_deletion_at) {
  await serviceClient.from('profiles').update({ scheduled_deletion_at: null }).eq('id', user.id);
  return NextResponse.json({ email: user.email, justCancelledDeletion: true });
}

return NextResponse.json({ email: user.email });
```

Wait — this branch already clears any pending deletion unconditionally on every `/api/session` call (including AppNav's, on every page), which means a deletion can never actually stay "pending" long enough for Settings to show a countdown; it gets auto-cancelled the instant any page loads after the request. That is Task 17's **intended** behavior per spec decision 8 ("signing back in during the grace period auto-cancels") — but it means there is no "currently pending, not yet cancelled" moment for Settings to display *after* the request that scheduled it, other than the immediate response of `POST /api/settings/delete-account` itself, which the page already receives synchronously. Given that, Settings does not need a persisted "pending" view at all beyond the single request/response: **Step 1 above is a no-op** (Task 17 already did everything needed) — Settings shows the countdown purely from the `scheduledDeletionAt` returned directly by `POST /api/settings/delete-account`'s own response, held in local component state for the remainder of that session, with no separate read path needed. If the user navigates away and back (a full new page load hitting `/api/session` again), Task 17's auto-cancel has already fired, so they correctly see the normal Danger Zone again rather than a countdown — which is the honest behavior spec decision 8 actually describes ("the only way to cancel is to keep using the account").

- [ ] **Step 2: Write the failing test**

Replace the existing `it('arms and cancels the delete-account confirmation ...', ...)` test in `tests/unit/app/settings/page.test.tsx` with:

```ts
it('deletes the account for real and shows the scheduled-deletion countdown', async () => {
  const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (url === '/api/session') return Promise.resolve({ status: 200, json: async () => ({ email: 'creator@example.com' }) });
    if (url === '/api/settings/delete-account') {
      return Promise.resolve({ ok: true, json: async () => ({ scheduledDeletionAt: '2026-10-14T00:00:00.000Z' }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
  vi.stubGlobal('fetch', fetchMock);

  render(<SettingsPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Delete account' }));
  fireEvent.click(screen.getByRole('button', { name: /yes, delete everything/i }));

  await waitFor(() => expect(screen.getByText(/your account will be deleted on/i)).toBeInTheDocument());
  expect(screen.queryByRole('button', { name: 'Delete account' })).not.toBeInTheDocument();
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/app/settings/page.test.tsx`
Expected: FAIL — the confirm step still shows "isn't available yet" with no real call, and there's no countdown view.

- [ ] **Step 4: Implement**

In `app/settings/page.tsx`, replace `deleteArmed`'s local-only confirm block with a real two-step flow plus a terminal countdown state. Add near the other `useState` declarations:

```ts
const [scheduledDeletionAt, setScheduledDeletionAt] = useState<string | null>(null);
const [deleteError, setDeleteError] = useState<string | null>(null);
```

Replace the Danger `<section>` body:

```tsx
<p className="text-sm leading-[1.5] text-gray-600">
  Permanently delete your account and all diagnostics, recaps, and saved ideas. This can&apos;t be undone.
</p>
{scheduledDeletionAt ? (
  <p className="text-sm text-gray-700">
    Your account will be deleted on {new Date(scheduledDeletionAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}. Sign in again before then to keep it.
  </p>
) : deleteArmed ? (
  <div className="flex flex-col gap-3 rounded-xl border border-[#f7cfc8] border-t-2 border-t-[#ef4444] bg-gradient-to-br from-[#fef2f2] to-[#fde4e0] px-4 py-[15px]">
    <p className="text-sm leading-[1.5] text-[#1f2937]">This will erase everything. Are you sure?</p>
    <div className="flex gap-2.5">
      <button
        type="button"
        onClick={async () => {
          setDeleteError(null);
          const res = await fetch('/api/settings/delete-account', { method: 'POST' });
          const data = await res.json();
          if (!res.ok) {
            setDeleteError(data.error ?? 'Something went wrong. Please try again.');
            return;
          }
          setScheduledDeletionAt(data.scheduledDeletionAt);
          setDeleteArmed(false);
        }}
        className="whitespace-nowrap rounded-full bg-[#dc2626] px-[18px] py-2.5 text-[13px] font-semibold text-white"
      >
        Yes, delete everything
      </button>
      <button
        type="button"
        onClick={() => setDeleteArmed(false)}
        className="whitespace-nowrap rounded-full border border-[#d8d8e0] bg-white px-[18px] py-2.5 text-[13px] font-semibold text-gray-700"
      >
        Cancel
      </button>
    </div>
    {deleteError && (
      <p role="alert" className="text-sm text-[#b91c1c]">
        {deleteError}
      </p>
    )}
  </div>
) : (
  <button
    type="button"
    onClick={() => setDeleteArmed(true)}
    className="self-start whitespace-nowrap rounded-full border border-[#f0c8c2] px-[18px] py-2.5 text-[13px] font-semibold text-[#b91c1c]"
  >
    Delete account
  </button>
)}
```

Remove the now-unused "not available yet" copy and the `Close` button that previously accompanied it.

- [ ] **Step 5: Show the one-time "deletion canceled" notice from bootstrap**

Task 17's `GET /api/session` returns `justCancelledDeletion: true` on the one response where it just auto-cancelled a pending deletion — and `app/settings/page.tsx`'s own bootstrap `useEffect` already calls this exact endpoint (`fetch('/api/session')`, feeding `dispatch({ type: 'BOOTSTRAPPED', ... })`). Thread the flag into a small local notice. Add near the other `useState` declarations:

```ts
const [justCancelledDeletion, setJustCancelledDeletion] = useState(false);
```

In the bootstrap `useEffect`'s success branch, before the existing `dispatch({ type: 'BOOTSTRAPPED', ... })` call, add:

```ts
if (data.justCancelledDeletion) {
  setJustCancelledDeletion(true);
}
```

Render it once, near the top of the main authenticated return block (just above the `<h1>Settings</h1>` heading):

```tsx
{justCancelledDeletion && (
  <Banner variant="positive" label="Welcome back">
    Your account deletion was canceled.
  </Banner>
)}
```

(`Banner` is still imported at this point in the plan — Task 20 removes the import only after this usage is itself removed, so there is no ordering conflict between the two tasks.)

Add a test to `tests/unit/app/settings/page.test.tsx`:

```ts
it('shows a one-time notice when signing back in cancels a pending deletion', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ status: 200, json: async () => ({ email: 'creator@example.com', justCancelledDeletion: true }) })
  );
  render(<SettingsPage />);
  expect(await screen.findByText(/account deletion was canceled/i)).toBeInTheDocument();
});
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/unit/app/settings/page.test.tsx`
Expected: PASS

- [ ] **Step 7: Run the full suite and typecheck**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS — fix forward if any earlier task's test file broke; do not skip this step.

- [ ] **Step 8: Commit**

```bash
git add app/settings/page.tsx tests/unit/app/settings/page.test.tsx
git commit -m "feat(settings): wire real account deletion with grace-period countdown"
```

---

### Task 20: Final Preview-banner cleanup and full-suite verification

**Files:**
- Modify: `app/settings/page.tsx`
- Test: `tests/unit/app/settings/page.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing further — this is the plan's final task.

Every section this plan set out to make real is real by now except password (intentionally dropped, per Global Constraints). This task removes the top Preview banner entirely (nothing left to disclose) and does a final whole-plan verification pass.

- [ ] **Step 1: Remove the Preview banner**

In `app/settings/page.tsx`, delete the `<Banner variant="info" label="Preview">...</Banner>` block entirely. **Keep the `Banner` import** — Task 19 added a permanent `<Banner variant="positive" label="Welcome back">` for the deletion-cancelled notice, so this component is still in use on this page after the Preview banner is gone.

- [ ] **Step 2: Update the test that asserted the banner's presence**

Search `tests/unit/app/settings/page.test.tsx` for any assertion checking for the word "Preview" or the banner's disclosure text (there should be none added by this plan's own tasks, since none of them tested banner copy directly — but check the original pre-existing test suite from before this plan, which may have asserted the Preview banner's presence as part of "shows every section once signed in"). If found, remove that specific assertion; leave the rest of that test intact.

- [ ] **Step 3: Run the full test suite and typecheck**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS — every test file touched across all 20 tasks passes together, not just in isolation. This is the single point in the whole plan where a cross-task regression (a shared file edited by two tasks in a way that only conflicts when combined) would surface. Fix forward; do not skip this step.

- [ ] **Step 4: Manual smoke check**

Start the dev server (`npm run dev`) and, signed in as a real test account, click through Settings once: save a display name, connect/disconnect a platform (if OAuth credentials are configured in this environment), toggle a notification, change timezone, enroll and verify 2FA with a real authenticator app, then sign out and confirm the next magic-link sign-in prompts for the TOTP code. This is the one path no unit test can cover — real Supabase MFA state and a real QR code render.

- [ ] **Step 5: Commit**

```bash
git add app/settings/page.tsx tests/unit/app/settings/page.test.tsx
git commit -m "feat(settings): remove preview banner now that every section is real"
```
