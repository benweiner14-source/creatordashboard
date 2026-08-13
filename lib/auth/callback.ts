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
