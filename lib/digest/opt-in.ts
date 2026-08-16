export interface SaveDigestOptInDeps {
  getProfileNiche: (profileId: string) => Promise<string | null>;
  updateDigestOptIn: (profileId: string, optIn: boolean) => Promise<void>;
}

export interface SaveDigestOptInParams {
  profileId: string;
  optIn: boolean;
}

export interface SaveDigestOptInResult {
  status: number;
  body: { ok: true } | { error: string };
}

export async function saveDigestOptIn(deps: SaveDigestOptInDeps, params: SaveDigestOptInParams): Promise<SaveDigestOptInResult> {
  if (params.optIn) {
    const niche = await deps.getProfileNiche(params.profileId);
    if (!niche) {
      return { status: 400, body: { error: 'Set your niche before turning on weekly emails.' } };
    }
  }

  await deps.updateDigestOptIn(params.profileId, params.optIn);
  return { status: 200, body: { ok: true } };
}
