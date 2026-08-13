# Sign-In Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build inline, point-of-friction magic-link sign-in on the diagnostic page: an unauthenticated submit shows an email form in place, the emailed link round-trips the user back to `/diagnostic` with their pasted URL restored (never auto-submitted), and every state/error/loading surface follows the project's newly-vendored design skills.

**Architecture:** A pure, unit-testable state machine (`lib/auth/sign-in-flow-state.ts`) drives `app/diagnostic/page.tsx` via `useReducer`. Two DI-style pure handlers (`lib/auth/magic-link.ts`, `lib/auth/callback.ts`) mirror the existing `lib/diagnostic/handler.ts` pattern — real Supabase calls are injected, so both are testable without a live project. `middleware.ts` refreshes the Supabase session cookie on navigation using the modern `getAll`/`setAll` cookie API. Two new UI components (`Spinner`, `SignInPrompt`) render the new states; the existing URL form gets the same loading/error treatment for consistency.

**Tech Stack:** Next.js 14 (App Router) + TypeScript + Tailwind, `@supabase/ssr` (already `^0.12.0`), Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-13-sign-in-flow-design.md` (committed at `559c366`) — this plan implements every section of that spec; read it alongside this plan for the "why" behind each design choice.

## Global Constraints

- Identity is Supabase magic-link email auth only — no password, no OAuth provider, no account settings UI.
- The pasted diagnostic URL must survive the full magic-link round trip on **both** the success and failure/expired branches (spec §2) — never require the user to re-paste it after a valid click.
- The app must never auto-submit the diagnostic on the user's behalf after they return from the email link — they click "Get my report" themselves (spec, decision #2).
- Niche selection is explicitly out of scope for this flow.
- The magic-link response is identical regardless of whether the email has an existing account (spec §4a security note) — never let a status code or message reveal account existence.
- Follow the existing DI pattern: pure, dependency-injected core logic in `lib/`, thin `route.ts` wrappers that wire real Supabase clients — same shape as `lib/diagnostic/handler.ts` / `app/api/diagnostic/route.ts`.
- New server-side Supabase code that needs session-refresh correctness (`middleware.ts`) uses the modern `getAll`/`setAll` cookie API, not the deprecated `get/set/remove` overload already used in `lib/supabase/server.ts`.
- Error messages follow "what happened / why / what to do" (spec §4); form input values are never cleared on error; validation on the email field happens on blur, not on keystroke (spec §3).

---

## File Structure

```
lib/auth/
  sign-in-flow-state.ts       # pure reducer: SignInFlowState, SignInFlowEvent, signInFlowReducer, guards
  magic-link.ts                # requestMagicLink(deps, params) — DI, testable
  callback.ts                  # handleAuthCallback(deps, context) — DI, testable

middleware.ts                  # Supabase session-refresh middleware (getAll/setAll)

app/api/auth/magic-link/route.ts   # POST /api/auth/magic-link — thin wrapper
app/auth/callback/route.ts         # GET /auth/callback — thin wrapper

components/
  Spinner.tsx                  # shared inline loading indicator
  SignInPrompt.tsx              # email form UI for needsSignIn/submittingMagicLink/checkEmail/magicLinkError

app/diagnostic/page.tsx        # MODIFIED — full state machine, query-param hydration, URL-form polish

tests/unit/lib/auth/sign-in-flow-state.test.ts
tests/unit/lib/auth/magic-link.test.ts
tests/unit/lib/auth/callback.test.ts
tests/unit/middleware.test.ts
tests/unit/components/Spinner.test.tsx
tests/unit/components/SignInPrompt.test.tsx
tests/unit/app/diagnostic/page.test.tsx   # MODIFIED — rewritten for the new state machine
tests/e2e/diagnostic-smoke.spec.ts        # MODIFIED — new round-trip test appended
```

---

### Task 1: Sign-in flow state machine

**Files:**
- Create: `lib/auth/sign-in-flow-state.ts`
- Test: `tests/unit/lib/auth/sign-in-flow-state.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `SignInFlowState`, `SignInFlowEvent`, `signInFlowReducer(state, event)`, `createInitialSignInFlowState(params)`, `isValidEmailFormat(email)`, `isValidUrlFormat(url)` — relied on by Tasks 2, 6, 7

- [ ] **Step 1: Write the failing test**
```ts
// tests/unit/lib/auth/sign-in-flow-state.test.ts
import { describe, it, expect } from 'vitest';
import {
  signInFlowReducer,
  createInitialSignInFlowState,
  isValidEmailFormat,
  isValidUrlFormat,
  type SignInFlowState,
} from '@/lib/auth/sign-in-flow-state';

describe('createInitialSignInFlowState', () => {
  it('starts idle with an empty url by default', () => {
    expect(createInitialSignInFlowState()).toEqual({ status: 'idle', url: '', error: null });
  });

  it('starts idle with a restored url when only url is provided', () => {
    expect(createInitialSignInFlowState({ url: 'https://tiktok.com/x' })).toEqual({
      status: 'idle',
      url: 'https://tiktok.com/x',
      error: null,
    });
  });

  it('starts in needsSignIn with a notice when authError=expired and a url are both present', () => {
    expect(createInitialSignInFlowState({ url: 'https://tiktok.com/x', authError: 'expired' })).toEqual({
      status: 'needsSignIn',
      url: 'https://tiktok.com/x',
      email: '',
      notice: 'That sign-in link expired or was already used. Enter your email again to get a new one.',
    });
  });

  it('ignores authError=expired without a url and starts idle', () => {
    expect(createInitialSignInFlowState({ authError: 'expired' })).toEqual({ status: 'idle', url: '', error: null });
  });
});

describe('signInFlowReducer — diagnostic submission path', () => {
  it('moves from idle to submittingDiagnostic on a valid SUBMIT_DIAGNOSTIC', () => {
    const state: SignInFlowState = { status: 'idle', url: 'https://tiktok.com/x', error: null };
    const next = signInFlowReducer(state, { type: 'SUBMIT_DIAGNOSTIC' });
    expect(next).toEqual({ status: 'submittingDiagnostic', url: 'https://tiktok.com/x', stillWorking: false });
  });

  it('ignores SUBMIT_DIAGNOSTIC with an empty url', () => {
    const state: SignInFlowState = { status: 'idle', url: '', error: null };
    expect(signInFlowReducer(state, { type: 'SUBMIT_DIAGNOSTIC' })).toBe(state);
  });

  it('sets stillWorking on DIAGNOSTIC_STILL_WORKING without changing status', () => {
    const state: SignInFlowState = { status: 'submittingDiagnostic', url: 'https://tiktok.com/x', stillWorking: false };
    const next = signInFlowReducer(state, { type: 'DIAGNOSTIC_STILL_WORKING' });
    expect(next).toEqual({ status: 'submittingDiagnostic', url: 'https://tiktok.com/x', stillWorking: true });
  });

  it('moves to redirectingToReport on DIAGNOSTIC_SUCCESS', () => {
    const state: SignInFlowState = { status: 'submittingDiagnostic', url: 'https://tiktok.com/x', stillWorking: true };
    const next = signInFlowReducer(state, { type: 'DIAGNOSTIC_SUCCESS', diagnosticId: 'diag-1' });
    expect(next).toEqual({ status: 'redirectingToReport', url: 'https://tiktok.com/x', diagnosticId: 'diag-1' });
  });

  it('moves to needsSignIn with no notice on DIAGNOSTIC_UNAUTHORIZED', () => {
    const state: SignInFlowState = { status: 'submittingDiagnostic', url: 'https://tiktok.com/x', stillWorking: false };
    const next = signInFlowReducer(state, { type: 'DIAGNOSTIC_UNAUTHORIZED' });
    expect(next).toEqual({ status: 'needsSignIn', url: 'https://tiktok.com/x', email: '', notice: null });
  });

  it('moves to diagnosticError preserving the url on DIAGNOSTIC_FAILED', () => {
    const state: SignInFlowState = { status: 'submittingDiagnostic', url: 'https://tiktok.com/x', stillWorking: false };
    const next = signInFlowReducer(state, { type: 'DIAGNOSTIC_FAILED', error: 'boom' });
    expect(next).toEqual({ status: 'diagnosticError', url: 'https://tiktok.com/x', error: 'boom' });
  });

  it('returns to idle preserving the url on RETRY_DIAGNOSTIC', () => {
    const state: SignInFlowState = { status: 'diagnosticError', url: 'https://tiktok.com/x', error: 'boom' };
    expect(signInFlowReducer(state, { type: 'RETRY_DIAGNOSTIC' })).toEqual({
      status: 'idle',
      url: 'https://tiktok.com/x',
      error: null,
    });
  });

  it('ignores URL_CHANGED while a submission is in flight (impossible-state guard)', () => {
    const state: SignInFlowState = { status: 'submittingDiagnostic', url: 'https://tiktok.com/x', stillWorking: false };
    expect(signInFlowReducer(state, { type: 'URL_CHANGED', url: 'https://tiktok.com/y' })).toBe(state);
  });
});

describe('signInFlowReducer — sign-in path', () => {
  it('returns to idle on EDIT_URL from needsSignIn', () => {
    const state: SignInFlowState = { status: 'needsSignIn', url: 'https://tiktok.com/x', email: '', notice: null };
    expect(signInFlowReducer(state, { type: 'EDIT_URL' })).toEqual({
      status: 'idle',
      url: 'https://tiktok.com/x',
      error: null,
    });
  });

  it('ignores SUBMIT_EMAIL with an invalid email format (impossible-state guard)', () => {
    const state: SignInFlowState = { status: 'needsSignIn', url: 'https://tiktok.com/x', email: 'not-an-email', notice: null };
    expect(signInFlowReducer(state, { type: 'SUBMIT_EMAIL' })).toBe(state);
  });

  it('moves to submittingMagicLink on a valid SUBMIT_EMAIL', () => {
    const state: SignInFlowState = {
      status: 'needsSignIn',
      url: 'https://tiktok.com/x',
      email: 'creator@example.com',
      notice: null,
    };
    expect(signInFlowReducer(state, { type: 'SUBMIT_EMAIL' })).toEqual({
      status: 'submittingMagicLink',
      url: 'https://tiktok.com/x',
      email: 'creator@example.com',
    });
  });

  it('moves to checkEmail on MAGIC_LINK_SENT', () => {
    const state: SignInFlowState = { status: 'submittingMagicLink', url: 'https://tiktok.com/x', email: 'creator@example.com' };
    expect(signInFlowReducer(state, { type: 'MAGIC_LINK_SENT' })).toEqual({
      status: 'checkEmail',
      url: 'https://tiktok.com/x',
      email: 'creator@example.com',
    });
  });

  it('moves to magicLinkError preserving the email on MAGIC_LINK_FAILED', () => {
    const state: SignInFlowState = { status: 'submittingMagicLink', url: 'https://tiktok.com/x', email: 'creator@example.com' };
    expect(signInFlowReducer(state, { type: 'MAGIC_LINK_FAILED', error: 'boom' })).toEqual({
      status: 'magicLinkError',
      url: 'https://tiktok.com/x',
      email: 'creator@example.com',
      error: 'boom',
    });
  });

  it('re-enters submittingMagicLink on RESEND_EMAIL from checkEmail', () => {
    const state: SignInFlowState = { status: 'checkEmail', url: 'https://tiktok.com/x', email: 'creator@example.com' };
    expect(signInFlowReducer(state, { type: 'RESEND_EMAIL' })).toEqual({
      status: 'submittingMagicLink',
      url: 'https://tiktok.com/x',
      email: 'creator@example.com',
    });
  });

  it('returns to needsSignIn with notice cleared on RETRY_EMAIL from magicLinkError', () => {
    const state: SignInFlowState = {
      status: 'magicLinkError',
      url: 'https://tiktok.com/x',
      email: 'creator@example.com',
      error: 'boom',
    };
    expect(signInFlowReducer(state, { type: 'RETRY_EMAIL' })).toEqual({
      status: 'needsSignIn',
      url: 'https://tiktok.com/x',
      email: 'creator@example.com',
      notice: null,
    });
  });
});

describe('isValidEmailFormat', () => {
  it('accepts a plausible email', () => {
    expect(isValidEmailFormat('creator@example.com')).toBe(true);
  });

  it('rejects a string with no @ or domain', () => {
    expect(isValidEmailFormat('not-an-email')).toBe(false);
  });
});

describe('isValidUrlFormat', () => {
  it('accepts any non-empty string', () => {
    expect(isValidUrlFormat('https://tiktok.com/x')).toBe(true);
  });

  it('rejects an empty or whitespace-only string', () => {
    expect(isValidUrlFormat('   ')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/auth/sign-in-flow-state.test.ts`
Expected: FAIL with "Cannot find module '@/lib/auth/sign-in-flow-state'"

- [ ] **Step 3: Write minimal implementation**
```ts
// lib/auth/sign-in-flow-state.ts
export type SignInFlowState =
  | { status: 'idle'; url: string; error: string | null }
  | { status: 'submittingDiagnostic'; url: string; stillWorking: boolean }
  | { status: 'needsSignIn'; url: string; email: string; notice: string | null }
  | { status: 'submittingMagicLink'; url: string; email: string }
  | { status: 'checkEmail'; url: string; email: string }
  | { status: 'magicLinkError'; url: string; email: string; error: string }
  | { status: 'diagnosticError'; url: string; error: string }
  | { status: 'redirectingToReport'; url: string; diagnosticId: string };

export type SignInFlowEvent =
  | { type: 'URL_CHANGED'; url: string }
  | { type: 'SUBMIT_DIAGNOSTIC' }
  | { type: 'DIAGNOSTIC_STILL_WORKING' }
  | { type: 'DIAGNOSTIC_SUCCESS'; diagnosticId: string }
  | { type: 'DIAGNOSTIC_UNAUTHORIZED' }
  | { type: 'DIAGNOSTIC_FAILED'; error: string }
  | { type: 'RETRY_DIAGNOSTIC' }
  | { type: 'EDIT_URL' }
  | { type: 'EMAIL_CHANGED'; email: string }
  | { type: 'SUBMIT_EMAIL' }
  | { type: 'MAGIC_LINK_SENT' }
  | { type: 'MAGIC_LINK_FAILED'; error: string }
  | { type: 'RESEND_EMAIL' }
  | { type: 'RETRY_EMAIL' };

export function isValidEmailFormat(email: string): boolean {
  return /\S+@\S+\.\S+/.test(email);
}

export function isValidUrlFormat(url: string): boolean {
  return url.trim().length > 0;
}

export function createInitialSignInFlowState(params: { url?: string; authError?: string } = {}): SignInFlowState {
  const url = params.url ?? '';
  if (params.authError === 'expired' && url) {
    return {
      status: 'needsSignIn',
      url,
      email: '',
      notice: 'That sign-in link expired or was already used. Enter your email again to get a new one.',
    };
  }
  return { status: 'idle', url, error: null };
}

export function signInFlowReducer(state: SignInFlowState, event: SignInFlowEvent): SignInFlowState {
  switch (event.type) {
    case 'URL_CHANGED':
      return state.status === 'idle' ? { ...state, url: event.url } : state;

    case 'SUBMIT_DIAGNOSTIC':
      if (state.status !== 'idle' && state.status !== 'diagnosticError') return state;
      if (!isValidUrlFormat(state.url)) return state;
      return { status: 'submittingDiagnostic', url: state.url, stillWorking: false };

    case 'DIAGNOSTIC_STILL_WORKING':
      return state.status === 'submittingDiagnostic' ? { ...state, stillWorking: true } : state;

    case 'DIAGNOSTIC_SUCCESS':
      return state.status === 'submittingDiagnostic'
        ? { status: 'redirectingToReport', url: state.url, diagnosticId: event.diagnosticId }
        : state;

    case 'DIAGNOSTIC_UNAUTHORIZED':
      return state.status === 'submittingDiagnostic'
        ? { status: 'needsSignIn', url: state.url, email: '', notice: null }
        : state;

    case 'DIAGNOSTIC_FAILED':
      return state.status === 'submittingDiagnostic'
        ? { status: 'diagnosticError', url: state.url, error: event.error }
        : state;

    case 'RETRY_DIAGNOSTIC':
      return state.status === 'diagnosticError' ? { status: 'idle', url: state.url, error: null } : state;

    case 'EDIT_URL':
      return state.status === 'needsSignIn' ? { status: 'idle', url: state.url, error: null } : state;

    case 'EMAIL_CHANGED':
      return state.status === 'needsSignIn' || state.status === 'magicLinkError'
        ? { ...state, email: event.email }
        : state;

    case 'SUBMIT_EMAIL':
      if (state.status !== 'needsSignIn' && state.status !== 'magicLinkError') return state;
      if (!isValidEmailFormat(state.email)) return state;
      return { status: 'submittingMagicLink', url: state.url, email: state.email };

    case 'MAGIC_LINK_SENT':
      return state.status === 'submittingMagicLink'
        ? { status: 'checkEmail', url: state.url, email: state.email }
        : state;

    case 'MAGIC_LINK_FAILED':
      return state.status === 'submittingMagicLink'
        ? { status: 'magicLinkError', url: state.url, email: state.email, error: event.error }
        : state;

    case 'RESEND_EMAIL':
      return state.status === 'checkEmail'
        ? { status: 'submittingMagicLink', url: state.url, email: state.email }
        : state;

    case 'RETRY_EMAIL':
      return state.status === 'magicLinkError'
        ? { status: 'needsSignIn', url: state.url, email: state.email, notice: null }
        : state;

    default:
      return state;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/auth/sign-in-flow-state.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add lib/auth/sign-in-flow-state.ts tests/unit/lib/auth/sign-in-flow-state.test.ts
git commit -m "feat: add sign-in flow state machine"
```

---

### Task 2: Magic-link request logic + API route

**Files:**
- Create: `lib/auth/magic-link.ts`
- Create: `app/api/auth/magic-link/route.ts`
- Test: `tests/unit/lib/auth/magic-link.test.ts`

**Interfaces:**
- Consumes: `isValidEmailFormat` from `@/lib/auth/sign-in-flow-state` (Task 1); `createSupabaseServerClient` from `@/lib/supabase/server` (existing, Task 9 of the scaffold plan)
- Produces: `MagicLinkDeps`, `RequestMagicLinkParams`, `RequestMagicLinkResult`, `requestMagicLink(deps, params)` — relied on by Task 7 (the diagnostic page calls `POST /api/auth/magic-link`)

- [ ] **Step 1: Write the failing test**
```ts
// tests/unit/lib/auth/magic-link.test.ts
import { describe, it, expect, vi } from 'vitest';
import { requestMagicLink } from '@/lib/auth/magic-link';

describe('requestMagicLink', () => {
  it('rejects an invalid email format before calling Supabase', async () => {
    const signInWithOtp = vi.fn();
    const result = await requestMagicLink(
      { signInWithOtp },
      { email: 'not-an-email', redirectPath: '/diagnostic', origin: 'https://app.example.com' }
    );
    expect(result.status).toBe(400);
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it('sends a magic link with the redirect path embedded in emailRedirectTo', async () => {
    const signInWithOtp = vi.fn().mockResolvedValue({ error: null });
    const redirectPath = '/diagnostic?url=https%3A%2F%2Ftiktok.com%2Fx';
    const result = await requestMagicLink(
      { signInWithOtp },
      { email: 'creator@example.com', redirectPath, origin: 'https://app.example.com' }
    );
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true });
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: 'creator@example.com',
      emailRedirectTo: `https://app.example.com/auth/callback?next=${encodeURIComponent(redirectPath)}`,
    });
  });

  it('returns a rate-limit-specific message when Supabase reports a 429', async () => {
    const signInWithOtp = vi.fn().mockResolvedValue({ error: { message: 'rate limited', status: 429 } });
    const result = await requestMagicLink(
      { signInWithOtp },
      { email: 'creator@example.com', redirectPath: '/diagnostic', origin: 'https://app.example.com' }
    );
    expect(result.status).toBe(429);
    expect(result.body).toEqual({ error: "You've requested a few sign-in links in a row. Wait a minute and try again." });
  });

  it('returns a generic server error for other Supabase failures, without leaking account existence', async () => {
    const signInWithOtp = vi.fn().mockResolvedValue({ error: { message: 'boom' } });
    const result = await requestMagicLink(
      { signInWithOtp },
      { email: 'creator@example.com', redirectPath: '/diagnostic', origin: 'https://app.example.com' }
    );
    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: "We couldn't reach the server. Check your connection and try again." });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/auth/magic-link.test.ts`
Expected: FAIL with "Cannot find module '@/lib/auth/magic-link'"

- [ ] **Step 3: Write minimal implementation**
```ts
// lib/auth/magic-link.ts
import { isValidEmailFormat } from './sign-in-flow-state';

export interface MagicLinkDeps {
  signInWithOtp: (params: { email: string; emailRedirectTo: string }) => Promise<{
    error: { message: string; status?: number } | null;
  }>;
}

export interface RequestMagicLinkParams {
  email: string;
  redirectPath: string;
  origin: string;
}

export interface RequestMagicLinkResult {
  status: number;
  body: { ok: true } | { error: string };
}

export async function requestMagicLink(
  deps: MagicLinkDeps,
  params: RequestMagicLinkParams
): Promise<RequestMagicLinkResult> {
  if (!isValidEmailFormat(params.email)) {
    return { status: 400, body: { error: "That doesn't look like a valid email address. Double-check it and try again." } };
  }

  const emailRedirectTo = `${params.origin}/auth/callback?next=${encodeURIComponent(params.redirectPath)}`;
  const { error } = await deps.signInWithOtp({ email: params.email, emailRedirectTo });

  if (error) {
    if (error.status === 429) {
      return {
        status: 429,
        body: { error: "You've requested a few sign-in links in a row. Wait a minute and try again." },
      };
    }
    return { status: 500, body: { error: "We couldn't reach the server. Check your connection and try again." } };
  }

  return { status: 200, body: { ok: true } };
}
```
```ts
// app/api/auth/magic-link/route.ts
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requestMagicLink } from '@/lib/auth/magic-link';

export async function POST(request: Request) {
  const { email, redirectPath } = (await request.json()) as { email?: string; redirectPath?: string };
  if (!email) {
    return NextResponse.json({ error: 'An email address is required.' }, { status: 400 });
  }

  try {
    const supabase = createSupabaseServerClient();
    const origin = new URL(request.url).origin;

    const result = await requestMagicLink(
      { signInWithOtp: (params) => supabase.auth.signInWithOtp(params) },
      { email, redirectPath: redirectPath ?? '/diagnostic', origin }
    );

    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    console.error('Magic link request failed:', err);
    return NextResponse.json(
      { error: "We couldn't reach the server. Check your connection and try again." },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/auth/magic-link.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add lib/auth/magic-link.ts app/api/auth/magic-link/route.ts tests/unit/lib/auth/magic-link.test.ts
git commit -m "feat: add magic-link request handler and POST /api/auth/magic-link route"
```

---

### Task 3: Session-refresh middleware

**Files:**
- Create: `middleware.ts`
- Test: `tests/unit/middleware.test.ts`

**Interfaces:**
- Consumes: `createServerClient` from `@supabase/ssr` (existing dependency)
- Produces: `middleware(request)`, `config` — Next.js picks these up automatically from the file at the project root; not imported by other tasks, but required for the callback flow (Task 4) to actually persist the session cookie across the redirect back to `/diagnostic`

- [ ] **Step 1: Write the failing test**
```ts
// tests/unit/middleware.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const getUserMock = vi.fn().mockResolvedValue({ data: { user: null } });
vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({
    auth: { getUser: getUserMock },
  })),
}));

import { middleware } from '@/middleware';

describe('middleware', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-placeholder-key';
    getUserMock.mockClear();
  });

  it('refreshes the session by calling getUser and returns a response', async () => {
    const request = new NextRequest('https://app.example.com/diagnostic');
    const response = await middleware(request);
    expect(getUserMock).toHaveBeenCalledTimes(1);
    expect(response).toBeInstanceOf(Response);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/middleware.test.ts`
Expected: FAIL with "Cannot find module '@/middleware'"

- [ ] **Step 3: Write minimal implementation**
```ts
// middleware.ts
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    }
  );

  // Refreshing the session here (rather than only in server components) is
  // what lets the magic-link callback's session cookie be readable by the
  // very next request — the redirect back to /diagnostic.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/middleware.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add middleware.ts tests/unit/middleware.test.ts
git commit -m "feat: add Supabase session-refresh middleware"
```

---

### Task 4: Auth callback logic + route

**Files:**
- Create: `lib/auth/callback.ts`
- Create: `app/auth/callback/route.ts`
- Test: `tests/unit/lib/auth/callback.test.ts`

**Interfaces:**
- Consumes: `createSupabaseServerClient` from `@/lib/supabase/server` (existing)
- Produces: `CallbackHandlerDeps`, `CallbackRequestContext`, `CallbackHandlerResult`, `handleAuthCallback(deps, context)`, `extractUrlParam(nextValue)` — this task closes the loop described in spec §2; nothing later depends on it directly

- [ ] **Step 1: Write the failing test**
```ts
// tests/unit/lib/auth/callback.test.ts
import { describe, it, expect, vi } from 'vitest';
import { handleAuthCallback, extractUrlParam } from '@/lib/auth/callback';

describe('extractUrlParam', () => {
  it('reads the url query param out of a path+query string', () => {
    expect(extractUrlParam('/diagnostic?url=https%3A%2F%2Ftiktok.com%2Fx')).toBe('https://tiktok.com/x');
  });

  it('returns null when there is no url param', () => {
    expect(extractUrlParam('/diagnostic')).toBeNull();
  });
});

describe('handleAuthCallback', () => {
  it('redirects to the next path when code exchange succeeds', async () => {
    const exchangeCodeForSession = vi.fn().mockResolvedValue({ error: null });
    const result = await handleAuthCallback(
      { exchangeCodeForSession },
      { code: 'valid-code', next: '/diagnostic?url=https%3A%2F%2Ftiktok.com%2Fx', origin: 'https://app.example.com' }
    );
    expect(exchangeCodeForSession).toHaveBeenCalledWith('valid-code');
    expect(result.redirectUrl).toBe('https://app.example.com/diagnostic?url=https%3A%2F%2Ftiktok.com%2Fx');
  });

  it('redirects to /diagnostic with authError=expired and the preserved url when code exchange fails', async () => {
    const exchangeCodeForSession = vi.fn().mockResolvedValue({ error: { message: 'expired' } });
    const result = await handleAuthCallback(
      { exchangeCodeForSession },
      { code: 'stale-code', next: '/diagnostic?url=https%3A%2F%2Ftiktok.com%2Fx', origin: 'https://app.example.com' }
    );
    const redirectUrl = new URL(result.redirectUrl);
    expect(redirectUrl.pathname).toBe('/diagnostic');
    expect(redirectUrl.searchParams.get('authError')).toBe('expired');
    expect(redirectUrl.searchParams.get('url')).toBe('https://tiktok.com/x');
  });

  it('redirects to /diagnostic with authError=expired and no url when there is no code at all', async () => {
    const exchangeCodeForSession = vi.fn();
    const result = await handleAuthCallback(
      { exchangeCodeForSession },
      { code: null, next: '/diagnostic', origin: 'https://app.example.com' }
    );
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    const redirectUrl = new URL(result.redirectUrl);
    expect(redirectUrl.searchParams.get('authError')).toBe('expired');
    expect(redirectUrl.searchParams.has('url')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/auth/callback.test.ts`
Expected: FAIL with "Cannot find module '@/lib/auth/callback'"

- [ ] **Step 3: Write minimal implementation**
```ts
// lib/auth/callback.ts
export interface CallbackHandlerDeps {
  exchangeCodeForSession: (code: string) => Promise<{ error: { message: string } | null }>;
}

export interface CallbackRequestContext {
  code: string | null;
  next: string;
  origin: string;
}

export interface CallbackHandlerResult {
  redirectUrl: string;
}

export async function handleAuthCallback(
  deps: CallbackHandlerDeps,
  context: CallbackRequestContext
): Promise<CallbackHandlerResult> {
  if (context.code) {
    const { error } = await deps.exchangeCodeForSession(context.code);
    if (!error) {
      return { redirectUrl: new URL(context.next, context.origin).toString() };
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

export function extractUrlParam(nextValue: string): string | null {
  try {
    const parsed = new URL(nextValue, 'http://localhost');
    return parsed.searchParams.get('url');
  } catch {
    return null;
  }
}
```
```ts
// app/auth/callback/route.ts
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { handleAuthCallback } from '@/lib/auth/callback';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const next = requestUrl.searchParams.get('next') ?? '/diagnostic';

  const supabase = createSupabaseServerClient();
  const result = await handleAuthCallback(
    { exchangeCodeForSession: (c) => supabase.auth.exchangeCodeForSession(c) },
    { code, next, origin: requestUrl.origin }
  );

  return NextResponse.redirect(result.redirectUrl);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/auth/callback.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add lib/auth/callback.ts app/auth/callback/route.ts tests/unit/lib/auth/callback.test.ts
git commit -m "feat: add auth callback handler and GET /auth/callback route"
```

---

### Task 5: `Spinner` shared component

**Files:**
- Create: `components/Spinner.tsx`
- Test: `tests/unit/components/Spinner.test.tsx`

**Interfaces:**
- Consumes: nothing
- Produces: `<Spinner label={string}>` — relied on by Tasks 6 and 7

- [ ] **Step 1: Write the failing test**
```tsx
// tests/unit/components/Spinner.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Spinner } from '@/components/Spinner';

describe('Spinner', () => {
  it('renders its label with a status role', () => {
    render(<Spinner label="Analyzing…" />);
    expect(screen.getByRole('status')).toHaveTextContent('Analyzing…');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/Spinner.test.tsx`
Expected: FAIL with "Cannot find module '@/components/Spinner'"

- [ ] **Step 3: Write minimal implementation**
```tsx
// components/Spinner.tsx
export interface SpinnerProps {
  label: string;
}

export function Spinner({ label }: SpinnerProps) {
  return (
    <span className="inline-flex items-center gap-2" role="status">
      <span
        aria-hidden="true"
        className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
      />
      <span>{label}</span>
    </span>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/Spinner.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add components/Spinner.tsx tests/unit/components/Spinner.test.tsx
git commit -m "feat: add shared Spinner component"
```

---

### Task 6: `SignInPrompt` component

**Files:**
- Create: `components/SignInPrompt.tsx`
- Test: `tests/unit/components/SignInPrompt.test.tsx`

**Interfaces:**
- Consumes: `SignInFlowState`, `isValidEmailFormat` from `@/lib/auth/sign-in-flow-state` (Task 1); `<Spinner>` from `@/components/Spinner` (Task 5)
- Produces: `SignInPromptProps`, `<SignInPrompt>` — relied on by Task 7

- [ ] **Step 1: Write the failing test**
```tsx
// tests/unit/components/SignInPrompt.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SignInPrompt } from '@/components/SignInPrompt';
import type { SignInFlowState } from '@/lib/auth/sign-in-flow-state';

function renderPrompt(state: Extract<SignInFlowState, { status: 'needsSignIn' | 'submittingMagicLink' | 'checkEmail' | 'magicLinkError' }>) {
  const handlers = {
    onEmailChange: vi.fn(),
    onSubmitEmail: vi.fn(),
    onEditUrl: vi.fn(),
    onResend: vi.fn(),
    onRetryEmail: vi.fn(),
  };
  render(<SignInPrompt state={state} {...handlers} />);
  return handlers;
}

describe('SignInPrompt', () => {
  it('shows the pasted url and an email field in needsSignIn', () => {
    renderPrompt({ status: 'needsSignIn', url: 'https://tiktok.com/x', email: '', notice: null });
    expect(screen.getByText(/checking:/i)).toHaveTextContent('https://tiktok.com/x');
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });

  it('shows the notice message when present', () => {
    renderPrompt({
      status: 'needsSignIn',
      url: 'https://tiktok.com/x',
      email: '',
      notice: 'That sign-in link expired or was already used. Enter your email again to get a new one.',
    });
    expect(screen.getByText(/expired or was already used/i)).toBeInTheDocument();
  });

  it('shows a validation error on blur for an invalid email and does not call onSubmitEmail', () => {
    const handlers = renderPrompt({ status: 'needsSignIn', url: 'https://tiktok.com/x', email: 'not-an-email', notice: null });
    fireEvent.blur(screen.getByLabelText('Email'));
    expect(screen.getByText(/enter a valid email address/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /send sign-in link/i }));
    expect(handlers.onSubmitEmail).not.toHaveBeenCalled();
  });

  it('calls onSubmitEmail when the email is valid', () => {
    const handlers = renderPrompt({ status: 'needsSignIn', url: 'https://tiktok.com/x', email: 'creator@example.com', notice: null });
    fireEvent.click(screen.getByRole('button', { name: /send sign-in link/i }));
    expect(handlers.onSubmitEmail).toHaveBeenCalledTimes(1);
  });

  it('calls onEditUrl when the edit link is clicked', () => {
    const handlers = renderPrompt({ status: 'needsSignIn', url: 'https://tiktok.com/x', email: '', notice: null });
    fireEvent.click(screen.getByRole('button', { name: /not this link\? edit/i }));
    expect(handlers.onEditUrl).toHaveBeenCalledTimes(1);
  });

  it('disables the email field and shows a spinner while submittingMagicLink', () => {
    renderPrompt({ status: 'submittingMagicLink', url: 'https://tiktok.com/x', email: 'creator@example.com' });
    expect(screen.getByLabelText('Email')).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Sending…');
  });

  it('shows the confirmation message and a resend button in checkEmail', () => {
    const handlers = renderPrompt({ status: 'checkEmail', url: 'https://tiktok.com/x', email: 'creator@example.com' });
    expect(screen.getByText(/check your email/i)).toHaveTextContent('creator@example.com');
    fireEvent.click(screen.getByRole('button', { name: /resend/i }));
    expect(handlers.onResend).toHaveBeenCalledTimes(1);
  });

  it('shows the server error message and preserves the email in magicLinkError', () => {
    renderPrompt({
      status: 'magicLinkError',
      url: 'https://tiktok.com/x',
      email: 'creator@example.com',
      error: "You've requested a few sign-in links in a row. Wait a minute and try again.",
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Wait a minute');
    expect(screen.getByLabelText('Email')).toHaveValue('creator@example.com');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/SignInPrompt.test.tsx`
Expected: FAIL with "Cannot find module '@/components/SignInPrompt'"

- [ ] **Step 3: Write minimal implementation**
```tsx
// components/SignInPrompt.tsx
'use client';

import { useState } from 'react';
import { Spinner } from './Spinner';
import { isValidEmailFormat, type SignInFlowState } from '@/lib/auth/sign-in-flow-state';

type SignInPromptState = Extract<
  SignInFlowState,
  { status: 'needsSignIn' | 'submittingMagicLink' | 'checkEmail' | 'magicLinkError' }
>;

export interface SignInPromptProps {
  state: SignInPromptState;
  onEmailChange: (email: string) => void;
  onSubmitEmail: () => void;
  onEditUrl: () => void;
  onResend: () => void;
  onRetryEmail: () => void;
}

export function SignInPrompt({ state, onEmailChange, onSubmitEmail, onEditUrl, onResend }: SignInPromptProps) {
  const [blurError, setBlurError] = useState<string | null>(null);
  const email = state.status === 'checkEmail' ? state.email : state.email;

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-gray-200 p-4">
      <div className="flex items-center justify-between text-sm text-gray-600">
        <span>
          Checking: <span className="font-medium text-gray-900">{state.url}</span>
        </span>
        {state.status !== 'checkEmail' && (
          <button type="button" onClick={onEditUrl} className="text-indigo-700 underline">
            Not this link? Edit
          </button>
        )}
      </div>

      {state.status === 'needsSignIn' && state.notice && (
        <p className="text-sm text-amber-700">{state.notice}</p>
      )}

      {state.status === 'checkEmail' ? (
        <div className="flex flex-col gap-2">
          <p>
            Check your email — we sent a sign-in link to <strong>{email}</strong>. Click it to continue, then
            we&apos;ll bring you back here with your diagnostic ready to go.
          </p>
          <button type="button" onClick={onResend} className="self-start text-sm text-indigo-700 underline">
            Resend
          </button>
        </div>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (state.status === 'submittingMagicLink') return;
            if (!isValidEmailFormat(state.email)) {
              setBlurError('Enter a valid email address, like you@example.com');
              return;
            }
            onSubmitEmail();
          }}
          className="flex flex-col gap-3"
        >
          <p className="text-sm text-gray-700">Sign in with a one-time email link to get your report.</p>
          <label htmlFor="sign-in-email" className="text-sm font-medium text-gray-700">
            Email
          </label>
          <input
            id="sign-in-email"
            name="email"
            type="email"
            required
            value={state.email}
            onChange={(e) => {
              setBlurError(null);
              onEmailChange(e.target.value);
            }}
            onBlur={() => {
              if (state.email && !isValidEmailFormat(state.email)) {
                setBlurError('Enter a valid email address, like you@example.com');
              } else {
                setBlurError(null);
              }
            }}
            disabled={state.status === 'submittingMagicLink'}
            className="rounded-lg border border-gray-300 px-4 py-2"
          />
          <button
            type="submit"
            disabled={state.status === 'submittingMagicLink'}
            className="rounded-full bg-indigo-600 px-6 py-3 font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {state.status === 'submittingMagicLink' ? <Spinner label="Sending…" /> : 'Send sign-in link'}
          </button>
          {blurError && (
            <p role="alert" className="text-sm text-red-600">
              {blurError}
            </p>
          )}
          {state.status === 'magicLinkError' && (
            <p role="alert" className="text-sm text-red-600">
              {state.error}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/SignInPrompt.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add components/SignInPrompt.tsx tests/unit/components/SignInPrompt.test.tsx
git commit -m "feat: add SignInPrompt component"
```

---

### Task 7: Rewrite the diagnostic page around the state machine

**Files:**
- Modify: `app/diagnostic/page.tsx`
- Modify (rewrite): `tests/unit/app/diagnostic/page.test.tsx`

**Interfaces:**
- Consumes: `signInFlowReducer`, `createInitialSignInFlowState` from `@/lib/auth/sign-in-flow-state` (Task 1); `<Spinner>` (Task 5); `<SignInPrompt>` (Task 6); existing `POST /api/diagnostic` (unchanged) and new `POST /api/auth/magic-link` (Task 2) response shapes
- Produces: `DiagnosticInputPage` default export — the terminal integration point of this plan; exercised end-to-end by Task 8's Playwright test

- [ ] **Step 1: Write the failing test**
```tsx
// tests/unit/app/diagnostic/page.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const pushMock = vi.fn();
let mockSearchParams = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => mockSearchParams,
}));

import DiagnosticInputPage from '@/app/diagnostic/page';

describe('DiagnosticInputPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    pushMock.mockClear();
    mockSearchParams = new URLSearchParams();
  });

  it('submits the pasted URL and navigates to the report page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'diagnostic-1' }) }));
    render(<DiagnosticInputPage />);
    fireEvent.change(screen.getByLabelText(/paste a youtube, tiktok, or instagram link/i), {
      target: { value: 'https://www.tiktok.com/@user/video/123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /get my report/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/diagnostic/diagnostic-1'));
  });

  it('shows the inline sign-in prompt on a 401 and preserves the pasted URL', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'You must be signed in to run a diagnostic.' }) })
    );
    render(<DiagnosticInputPage />);
    fireEvent.change(screen.getByLabelText(/paste a youtube, tiktok, or instagram link/i), {
      target: { value: 'https://www.tiktok.com/@user/video/123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /get my report/i }));

    await waitFor(() => expect(screen.getByText(/checking:/i)).toHaveTextContent('https://www.tiktok.com/@user/video/123'));
  });

  it('submits the email from the sign-in prompt and shows the check-your-email confirmation', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: 'You must be signed in to run a diagnostic.' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<DiagnosticInputPage />);
    fireEvent.change(screen.getByLabelText(/paste a youtube, tiktok, or instagram link/i), {
      target: { value: 'https://www.tiktok.com/@user/video/123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /get my report/i }));
    await waitFor(() => screen.getByLabelText('Email'));

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'creator@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send sign-in link/i }));

    await waitFor(() => expect(screen.getByText(/check your email/i)).toHaveTextContent('creator@example.com'));
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/auth/magic-link',
      expect.objectContaining({
        body: JSON.stringify({
          email: 'creator@example.com',
          redirectPath: `/diagnostic?url=${encodeURIComponent('https://www.tiktok.com/@user/video/123')}`,
        }),
      })
    );
  });

  it('shows an error message and preserves the url when the diagnostic request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({ error: 'You have already used your free diagnostic for this 30-day period.' }) })
    );
    render(<DiagnosticInputPage />);
    fireEvent.change(screen.getByLabelText(/paste a youtube, tiktok, or instagram link/i), {
      target: { value: 'https://www.tiktok.com/@user/video/123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /get my report/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('already used your free diagnostic'));
    expect(screen.getByLabelText(/paste a youtube, tiktok, or instagram link/i)).toHaveValue('https://www.tiktok.com/@user/video/123');
  });

  it('shows an error message when the diagnostic request throws a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
    render(<DiagnosticInputPage />);
    fireEvent.change(screen.getByLabelText(/paste a youtube, tiktok, or instagram link/i), {
      target: { value: 'https://www.tiktok.com/@user/video/123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /get my report/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("your link hasn't been used up"));
  });

  it('pre-fills the url from ?url= on mount without auto-submitting', () => {
    mockSearchParams = new URLSearchParams('url=' + encodeURIComponent('https://www.tiktok.com/@user/video/123'));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<DiagnosticInputPage />);

    expect(screen.getByLabelText(/paste a youtube, tiktok, or instagram link/i)).toHaveValue('https://www.tiktok.com/@user/video/123');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lands directly in the sign-in prompt with a notice when returning from an expired magic link', () => {
    mockSearchParams = new URLSearchParams(
      'url=' + encodeURIComponent('https://www.tiktok.com/@user/video/123') + '&authError=expired'
    );
    render(<DiagnosticInputPage />);

    expect(screen.getByText(/expired or was already used/i)).toBeInTheDocument();
    expect(screen.getByText(/checking:/i)).toHaveTextContent('https://www.tiktok.com/@user/video/123');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/app/diagnostic/page.test.tsx`
Expected: FAIL — the current page has no `SignInPrompt`, no `?url=`/`?authError=` handling, and no `useSearchParams` mock target; several assertions above (checking the sign-in prompt, check-email confirmation, notice text) will fail against today's implementation.

- [ ] **Step 3: Write minimal implementation**
```tsx
// app/diagnostic/page.tsx
'use client';

import { Suspense, useEffect, useReducer, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Spinner } from '@/components/Spinner';
import { SignInPrompt } from '@/components/SignInPrompt';
import { signInFlowReducer, createInitialSignInFlowState } from '@/lib/auth/sign-in-flow-state';

function DiagnosticInputPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, dispatch] = useReducer(
    signInFlowReducer,
    undefined,
    () =>
      createInitialSignInFlowState({
        url: searchParams.get('url') ?? undefined,
        authError: searchParams.get('authError') ?? undefined,
      })
  );
  const stillWorkingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (state.status === 'submittingDiagnostic') {
      stillWorkingTimer.current = setTimeout(() => dispatch({ type: 'DIAGNOSTIC_STILL_WORKING' }), 8000);
      return () => clearTimeout(stillWorkingTimer.current);
    }
  }, [state.status]);

  useEffect(() => {
    if (state.status === 'redirectingToReport') {
      router.push(`/diagnostic/${state.diagnosticId}`);
    }
  }, [state, router]);

  async function submitDiagnostic(url: string) {
    try {
      const response = await fetch('/api/diagnostic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await response.json();
      if (response.status === 401) {
        dispatch({ type: 'DIAGNOSTIC_UNAUTHORIZED' });
        return;
      }
      if (!response.ok) {
        dispatch({ type: 'DIAGNOSTIC_FAILED', error: data.error ?? 'Something went wrong. Please try again.' });
        return;
      }
      dispatch({ type: 'DIAGNOSTIC_SUCCESS', diagnosticId: data.id });
    } catch {
      dispatch({
        type: 'DIAGNOSTIC_FAILED',
        error:
          "Something went wrong on our end generating your report. Try again in a moment — your link hasn't been used up.",
      });
    }
  }

  async function submitMagicLink(email: string, url: string) {
    try {
      const response = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, redirectPath: `/diagnostic?url=${encodeURIComponent(url)}` }),
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

  function handleDiagnosticSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.status !== 'idle' && state.status !== 'diagnosticError') return;
    const url = state.url;
    dispatch({ type: 'SUBMIT_DIAGNOSTIC' });
    void submitDiagnostic(url);
  }

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-6 py-16">
      <h1 className="text-2xl font-bold text-gray-900">Run a diagnostic</h1>

      {(state.status === 'idle' || state.status === 'submittingDiagnostic' || state.status === 'diagnosticError') && (
        <form onSubmit={handleDiagnosticSubmit} className="flex flex-col gap-4">
          <label htmlFor="url" className="text-sm font-medium text-gray-700">
            Paste a YouTube, TikTok, or Instagram link
          </label>
          <input
            id="url"
            name="url"
            type="url"
            required
            value={state.url}
            onChange={(e) => dispatch({ type: 'URL_CHANGED', url: e.target.value })}
            disabled={state.status === 'submittingDiagnostic'}
            placeholder="https://www.tiktok.com/@you/video/..."
            className="rounded-lg border border-gray-300 px-4 py-2"
          />
          <button
            type="submit"
            disabled={state.status === 'submittingDiagnostic'}
            className="rounded-full bg-indigo-600 px-6 py-3 font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {state.status === 'submittingDiagnostic' ? (
              <Spinner
                label={
                  state.stillWorking
                    ? "Still working — checking your video's stats and putting the report together…"
                    : 'Analyzing…'
                }
              />
            ) : (
              'Get my report'
            )}
          </button>
          {state.status === 'diagnosticError' && (
            <p role="alert" className="text-sm text-red-600">
              {state.error}
            </p>
          )}
        </form>
      )}

      {(state.status === 'needsSignIn' ||
        state.status === 'submittingMagicLink' ||
        state.status === 'checkEmail' ||
        state.status === 'magicLinkError') && (
        <SignInPrompt
          state={state}
          onEmailChange={(email) => dispatch({ type: 'EMAIL_CHANGED', email })}
          onSubmitEmail={() => {
            const { email, url } = state;
            dispatch({ type: 'SUBMIT_EMAIL' });
            void submitMagicLink(email, url);
          }}
          onEditUrl={() => dispatch({ type: 'EDIT_URL' })}
          onResend={() => {
            const { email, url } = state;
            dispatch({ type: 'RESEND_EMAIL' });
            void submitMagicLink(email, url);
          }}
          onRetryEmail={() => dispatch({ type: 'RETRY_EMAIL' })}
        />
      )}
    </main>
  );
}

export default function DiagnosticInputPage() {
  return (
    <Suspense fallback={<main className="mx-auto flex max-w-xl flex-col gap-6 px-6 py-16">Loading…</main>}>
      <DiagnosticInputPageInner />
    </Suspense>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/app/diagnostic/page.test.tsx`
Expected: PASS

- [ ] **Step 5: Run the full unit suite and typecheck to catch regressions in neighboring tests**

Run: `npm test && npm run typecheck`
Expected: PASS — in particular `tests/unit/app/page.test.tsx` and `tests/unit/app/diagnostic/id-page.test.tsx` are untouched by this task and should remain green.

- [ ] **Step 6: Commit**
```bash
git add app/diagnostic/page.tsx tests/unit/app/diagnostic/page.test.tsx
git commit -m "feat: rewrite diagnostic page around the sign-in flow state machine"
```

---

### Task 8: Playwright E2E — sign-in round trip

**Files:**
- Modify: `tests/e2e/diagnostic-smoke.spec.ts` (append a new test; the existing authenticated-happy-path test is unchanged)

**Interfaces:**
- Consumes: `/diagnostic` (Task 7), `POST /api/diagnostic` and `POST /api/auth/magic-link` (mocked at the network layer, matching the existing smoke test's convention)
- Produces: nothing consumed elsewhere — terminal verification for this plan

- [ ] **Step 1: Write the E2E test**

Append to `tests/e2e/diagnostic-smoke.spec.ts`:
```ts
test('an unauthenticated submission prompts inline sign-in, and a returning link pre-fills the URL without auto-submitting', async ({ page }) => {
  let diagnosticCallCount = 0;
  await page.route('**/api/diagnostic', async (route) => {
    diagnosticCallCount += 1;
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'You must be signed in to run a diagnostic.' }),
    });
  });

  await page.route('**/api/auth/magic-link', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  await page.goto('/diagnostic');
  await page.getByLabel(/paste a youtube, tiktok, or instagram link/i).fill('https://www.tiktok.com/@user/video/999');
  await page.getByRole('button', { name: /get my report/i }).click();

  await expect(page.getByText(/checking: https:\/\/www\.tiktok\.com\/@user\/video\/999/i)).toBeVisible();
  await page.getByLabel('Email').fill('creator@example.com');
  await page.getByRole('button', { name: /send sign-in link/i }).click();

  await expect(page.getByText(/check your email/i)).toBeVisible();
  expect(diagnosticCallCount).toBe(1);

  // Simulate returning from the magic-link email: the callback route would
  // redirect here with the original URL restored, unsubmitted.
  await page.goto('/diagnostic?url=' + encodeURIComponent('https://www.tiktok.com/@user/video/999'));
  const urlField = page.getByLabel(/paste a youtube, tiktok, or instagram link/i);
  await expect(urlField).toHaveValue('https://www.tiktok.com/@user/video/999');
  expect(diagnosticCallCount).toBe(1); // still 1 — no auto-submit occurred
});
```

- [ ] **Step 2: Run the test**

Run: `npm run build && npm run test:e2e`
Expected: PASS — 2 tests passed (the original smoke test plus this new one).

- [ ] **Step 3: Commit**
```bash
git add tests/e2e/diagnostic-smoke.spec.ts
git commit -m "test: add Playwright coverage for the sign-in round trip"
```

---

## Self-Review Notes

**Spec coverage:** §1 state machine → Task 1 (every state/event/transition/guard has a test); §2 callback round trip (both branches) → Task 4; §3 form design (email field, blur validation, existing URL field touch-up) → Tasks 6–7; §4 error copy (magic-link failure cases, expired-link notice, diagnostic error cases including the "your link hasn't been used up" reassurance) → Tasks 2, 4, 7; §5 loading states (spinner + 8s escalation, fast spinner for magic-link) → Tasks 5, 7; §6 file list → matches this plan's File Structure exactly, plus `middleware.ts` which the spec's file list implied but didn't itemize as its own bullet (added as Task 3, required for the callback's session cookie to actually persist).

**Placeholder scan:** No task contains TBD/TODO or unshown code. Task 7's "Step 5" (run full suite) is a verification step, not a placeholder — it has explicit pass criteria.

**Type consistency verified across tasks:** `SignInFlowState`/`SignInFlowEvent` (Task 1) are consumed with identical shapes in `SignInPrompt.tsx` (Task 6, via `Extract<...>`) and `app/diagnostic/page.tsx` (Task 7); `MagicLinkDeps`/`requestMagicLink` (Task 2) request/response shapes match what `app/diagnostic/page.tsx`'s `submitMagicLink` sends and expects (Task 7); `CallbackHandlerResult.redirectUrl` (Task 4) is a full absolute URL string in both branches, matching `NextResponse.redirect`'s expected input in `app/auth/callback/route.ts`; `Spinner`'s `label` prop (Task 5) is used identically in `SignInPrompt.tsx` and `app/diagnostic/page.tsx`.

---

## Execution Handoff

Once approved, choose an execution path:

1. **Subagent-Driven (recommended)** — `superpowers:subagent-driven-development`: a fresh implementer subagent per task, isolated in a git worktree, with a task-level review after each task and one final whole-branch review at the end. Matches how the original scaffold plan and the benchmark recalibration were executed in this project.
2. **Inline Execution** — `superpowers:executing-plans`: batch execution in this session with review checkpoints between tasks.

## Verification (end-to-end, once all 8 tasks are complete)

1. `npm run typecheck && npm run lint` — clean typecheck and lint.
2. `npm test` — full Vitest suite green, including the new `lib/auth/*`, `middleware`, `Spinner`, `SignInPrompt`, and rewritten diagnostic-page suites, alongside every pre-existing test.
3. `npm run build` — production build succeeds (confirms the `Suspense` boundary around `useSearchParams` doesn't trip a build-time bailout, and that `middleware.ts` compiles as an Edge-compatible entry point).
4. `npx playwright install --with-deps chromium && npm run test:e2e` — both the original diagnostic smoke test and the new sign-in round-trip test pass.
5. Manually re-read `docs/superpowers/specs/2026-08-13-sign-in-flow-design.md` §1's transition table against `lib/auth/sign-in-flow-state.ts` line by line to confirm no transition was silently dropped or altered during implementation.
