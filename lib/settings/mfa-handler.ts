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
