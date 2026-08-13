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
