export interface CallbackHandlerDeps {
  exchangeCodeForSession: (code: string) => Promise<{ error: { message: string } | null }>;
  hasVerifiedMfaFactor: () => Promise<boolean>;
}

export interface CallbackRequestContext {
  code: string | null;
  next: string;
  origin: string;
}

export interface CallbackHandlerResult {
  redirectUrl: string;
}

/**
 * Guards against open redirects: only a same-origin, root-relative path is
 * safe to hand to `new URL(path, origin)`. An absolute URL (e.g.
 * `https://evil.example`) or a protocol-relative URL (`//evil.example`)
 * would otherwise be honored verbatim.
 */
export function isSafeRelativePath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//');
}

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

export function extractUrlParam(nextValue: string): string | null {
  try {
    const parsed = new URL(nextValue, 'http://localhost');
    return parsed.searchParams.get('url');
  } catch {
    return null;
  }
}
