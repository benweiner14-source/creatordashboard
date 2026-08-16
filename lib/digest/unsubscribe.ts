export interface UnsubscribeDeps {
  verifyToken: (profileId: string, token: string) => boolean;
  setOptOut: (profileId: string) => Promise<void>;
}

export interface UnsubscribeParams {
  profileId: string | null;
  token: string | null;
}

export interface UnsubscribeResult {
  status: 'ok' | 'invalid';
}

export async function handleUnsubscribe(deps: UnsubscribeDeps, params: UnsubscribeParams): Promise<UnsubscribeResult> {
  if (!params.profileId || !params.token || !deps.verifyToken(params.profileId, params.token)) {
    return { status: 'invalid' };
  }
  await deps.setOptOut(params.profileId);
  return { status: 'ok' };
}
