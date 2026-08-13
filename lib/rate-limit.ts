import { createHash } from 'node:crypto';

export const FREE_DIAGNOSTIC_WINDOW_DAYS = 30;
export const FREE_DIAGNOSTIC_LIMIT_PER_PROFILE = 1;
export const MAX_PROFILES_PER_IP_WINDOW = 3;

export interface AtomicRateLimitCheckResult {
  allowed: boolean;
  reason?: 'profile_limit' | 'ip_limit';
  eventId?: string;
}

export interface RateLimitStore {
  countEventsSince(params: { profileId?: string; ipHash?: string; eventType: string; since: Date }): Promise<number>;
  recordEvent(params: { profileId: string | null; ipHash: string; eventType: string; createdAt?: Date }): Promise<void>;
  checkAndRecordAtomically(params: {
    profileId: string;
    ipHash: string;
    eventType: string;
    profileLimit: number;
    ipLimit: number;
    windowStart: Date;
    now: Date;
  }): Promise<AtomicRateLimitCheckResult>;
  releaseEvent(eventId: string): Promise<void>;
}

export interface RateLimitCheckParams {
  store: RateLimitStore;
  profileId: string;
  ipHash: string;
  eventType: string;
  now?: Date;
}

export interface RateLimitCheckResult {
  allowed: boolean;
  reason?: 'profile_limit' | 'ip_limit';
  retryAfter?: Date;
}

export async function checkRateLimit(params: RateLimitCheckParams): Promise<RateLimitCheckResult> {
  const now = params.now ?? new Date();
  const windowMs = FREE_DIAGNOSTIC_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const windowStart = new Date(now.getTime() - windowMs);

  const profileCount = await params.store.countEventsSince({
    profileId: params.profileId,
    eventType: params.eventType,
    since: windowStart,
  });
  if (profileCount >= FREE_DIAGNOSTIC_LIMIT_PER_PROFILE) {
    return { allowed: false, reason: 'profile_limit', retryAfter: new Date(now.getTime() + windowMs) };
  }

  const ipCount = await params.store.countEventsSince({
    ipHash: params.ipHash,
    eventType: params.eventType,
    since: windowStart,
  });
  if (ipCount >= MAX_PROFILES_PER_IP_WINDOW) {
    return { allowed: false, reason: 'ip_limit', retryAfter: new Date(now.getTime() + windowMs) };
  }

  return { allowed: true };
}

export async function recordRateLimitEvent(params: {
  store: RateLimitStore;
  profileId: string | null;
  ipHash: string;
  eventType: string;
  createdAt?: Date;
}): Promise<void> {
  await params.store.recordEvent(params);
}

export interface AtomicRateLimitCheckParams {
  store: RateLimitStore;
  profileId: string;
  ipHash: string;
  eventType: string;
  now?: Date;
  /** Overrides for callers other than the diagnostic flow (e.g. magic-link requests). */
  profileLimit?: number;
  ipLimit?: number;
  windowDays?: number;
}

export interface AtomicRateLimitResult extends AtomicRateLimitCheckResult {
  retryAfter?: Date;
}

/**
 * Atomically checks and records a rate-limit event in one round trip to the
 * store, closing the check-then-record race that calling checkRateLimit and
 * recordRateLimitEvent separately cannot guarantee. Callers should invoke
 * this before doing any expensive/paid work, and call releaseRateLimitEvent
 * if that work subsequently fails, so a server-side failure never consumes
 * the caller's rate-limit slot.
 */
export async function checkAndRecordRateLimit(params: AtomicRateLimitCheckParams): Promise<AtomicRateLimitResult> {
  const now = params.now ?? new Date();
  const windowDays = params.windowDays ?? FREE_DIAGNOSTIC_WINDOW_DAYS;
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const windowStart = new Date(now.getTime() - windowMs);
  const profileLimit = params.profileLimit ?? FREE_DIAGNOSTIC_LIMIT_PER_PROFILE;
  const ipLimit = params.ipLimit ?? MAX_PROFILES_PER_IP_WINDOW;

  const result = await params.store.checkAndRecordAtomically({
    profileId: params.profileId,
    ipHash: params.ipHash,
    eventType: params.eventType,
    profileLimit,
    ipLimit,
    windowStart,
    now,
  });

  if (!result.allowed) {
    return { ...result, retryAfter: new Date(now.getTime() + windowMs) };
  }
  return result;
}

export async function releaseRateLimitEvent(params: { store: RateLimitStore; eventId: string }): Promise<void> {
  await params.store.releaseEvent(params.eventId);
}

export function hashIp(ip: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex');
}
