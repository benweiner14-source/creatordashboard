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

export function hashIp(ip: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex');
}
