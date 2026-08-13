import { isValidEmailFormat } from './sign-in-flow-state';
import { isSafeRelativePath } from './callback';
import { checkAndRecordRateLimit, releaseRateLimitEventIfNeeded, hashIdentity, type RateLimitStore } from '@/lib/rate-limit';

export const MAGIC_LINK_EMAIL_LIMIT = 3;
export const MAGIC_LINK_IP_LIMIT = 10;
export const MAGIC_LINK_WINDOW_MINUTES = 15;

export interface MagicLinkDeps {
  signInWithOtp: (params: { email: string; emailRedirectTo: string }) => Promise<{
    error: { message: string; status?: number } | null;
  }>;
  rateLimitStore: RateLimitStore;
  ipSalt: string;
}

export interface RequestMagicLinkParams {
  email: string;
  redirectPath: string;
  origin: string;
  ip: string;
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

  const identityHash = hashIdentity(params.email.toLowerCase(), deps.ipSalt);
  const ipHash = hashIdentity(params.ip, deps.ipSalt);

  const rateLimitResult = await checkAndRecordRateLimit({
    store: deps.rateLimitStore,
    identityHash,
    ipHash,
    eventType: 'magic_link_request',
    profileLimit: MAGIC_LINK_EMAIL_LIMIT,
    ipLimit: MAGIC_LINK_IP_LIMIT,
    // checkAndRecordRateLimit's window is expressed in days; magic-link
    // requests need a much shorter window than the diagnostic flow's
    // 30-day one, so this converts minutes to a fractional day count.
    windowDays: MAGIC_LINK_WINDOW_MINUTES / (24 * 60),
  });

  if (!rateLimitResult.allowed) {
    return {
      status: 429,
      body: {
        error:
          rateLimitResult.reason === 'ip_limit'
            ? 'Too many sign-in requests have come from this network recently. Please try again later.'
            : "You've requested a few sign-in links in a row. Wait a minute and try again.",
      },
    };
  }

  const redirectPath = isSafeRelativePath(params.redirectPath) ? params.redirectPath : '/diagnostic';
  const emailRedirectTo = `${params.origin}/auth/callback?next=${encodeURIComponent(redirectPath)}`;

  try {
    const { error } = await deps.signInWithOtp({ email: params.email, emailRedirectTo });

    if (error) {
      await releaseRateLimitEventIfNeeded({ store: deps.rateLimitStore, eventId: rateLimitResult.eventId });
      if (error.status === 429) {
        return {
          status: 429,
          body: { error: "You've requested a few sign-in links in a row. Wait a minute and try again." },
        };
      }
      return { status: 500, body: { error: "We couldn't reach the server. Check your connection and try again." } };
    }

    return { status: 200, body: { ok: true } };
  } catch (err) {
    await releaseRateLimitEventIfNeeded({ store: deps.rateLimitStore, eventId: rateLimitResult.eventId });
    throw err;
  }
}
