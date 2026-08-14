const MAX_NICHE_LENGTH = 200;

export interface SaveNicheDeps {
  updateProfileNiche: (profileId: string, niche: string) => Promise<void>;
}

export interface SaveNicheParams {
  profileId: string;
  niche: string;
}

export interface SaveNicheResult {
  status: number;
  body: { ok: true } | { error: string };
}

export async function saveNiche(deps: SaveNicheDeps, params: SaveNicheParams): Promise<SaveNicheResult> {
  const trimmed = params.niche.trim();
  if (!trimmed) {
    return { status: 400, body: { error: 'Enter a niche before saving.' } };
  }
  if (trimmed.length > MAX_NICHE_LENGTH) {
    return { status: 400, body: { error: `Keep your niche under ${MAX_NICHE_LENGTH} characters.` } };
  }

  await deps.updateProfileNiche(params.profileId, trimmed);
  return { status: 200, body: { ok: true } };
}
