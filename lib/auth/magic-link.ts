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
  // A pasted email with stray leading/trailing whitespace passes the
  // (unanchored) format check below but was never trimmed anywhere before
  // reaching Supabase -- trim once here, at the boundary, so every caller
  // (there are several duplicated client-side reducers) is covered.
  const email = params.email.trim();

  if (!isValidEmailFormat(email)) {
    return { status: 400, body: { error: "That doesn't look like a valid email address. Double-check it and try again." } };
  }

  const identityHash = hashIdentity(email.toLowerCase(), deps.ipSalt);
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
    const { error } = await deps.signInWithOtp({ email, emailRedirectTo });

    if (error) {
      if (error.status === 429) {
        // Supabase's own OTP-send rate limit, distinct from and independent
        // of checkAndRecordRateLimit above -- deliberately NOT releasing the
        // slot here (unlike every other failure branch): a genuine attempt
        // was made and Supabase itself chose to reject it, so it should
        // still count against the local quota. Releasing it let a rapid
        // client retry loop keep re-hitting Supabase's own limit, and it
        // erased the only evidence (the row) that the attempt happened.
        return {
          status: 429,
          body: {
            error: 'Our email provider is briefly rate-limiting sign-in emails right now. Please wait a few minutes and try again.',
          },
        };
      }
      await releaseRateLimitEventIfNeeded({ store: deps.rateLimitStore, eventId: rateLimitResult.eventId });
      return { status: 500, body: { error: "We couldn't reach the server. Check your connection and try again." } };
    }

    return { status: 200, body: { ok: true } };
  } catch (err) {
    await releaseRateLimitEventIfNeeded({ store: deps.rateLimitStore, eventId: rateLimitResult.eventId });
    throw err;
  }
}
