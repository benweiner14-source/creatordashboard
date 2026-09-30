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
