import { checkAndRecordRateLimit, type RateLimitStore } from '@/lib/rate-limit';

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

export interface VerifyMfaDeps {
  rateLimitStore: RateLimitStore;
  // Wraps supabase.auth.mfa.challengeAndVerify as one call — see route wiring.
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
