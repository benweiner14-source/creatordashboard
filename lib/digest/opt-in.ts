export interface SaveDigestOptInDeps {
  getProfileNiche: (profileId: string) => Promise<string | null>;
  updateDigestOptIn: (profileId: string, optIn: boolean) => Promise<void>;
  hasActiveSubscription: (profileId: string) => Promise<boolean>;
}

export interface SaveDigestOptInParams {
  profileId: string;
  optIn: boolean;
}

export interface SaveDigestOptInResult {
  status: number;
  body: { ok: true } | { error: string; upgradeUrl?: string };
}

export async function saveDigestOptIn(deps: SaveDigestOptInDeps, params: SaveDigestOptInParams): Promise<SaveDigestOptInResult> {
  if (params.optIn) {
    if (!(await deps.hasActiveSubscription(params.profileId))) {
      return { status: 402, body: { error: 'Weekly email delivery requires an active subscription.', upgradeUrl: '/billing' } };
    }
    const niche = await deps.getProfileNiche(params.profileId);
    if (!niche) {
      return { status: 400, body: { error: 'Set your niche before turning on weekly emails.' } };
    }
  }

  await deps.updateDigestOptIn(params.profileId, params.optIn);
  return { status: 200, body: { ok: true } };
}
