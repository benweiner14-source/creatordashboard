export interface UpdateProfileDeps {
  saveDisplayName: (profileId: string, displayName: string) => Promise<void>;
}

export interface UpdateProfileContext {
  profileId: string | null;
  displayName: string;
}

export interface UpdateProfileResult {
  status: number;
  body: Record<string, unknown>;
}

export interface ProfileRecord {
  displayName: string | null;
  timezone: string | null;
  locale: string | null;
}

export interface GetProfileDeps {
  // A single dep returning all three fields in one query, mirroring the
  // route's single `select('display_name, timezone, locale')` call — see
  // finding I2 in the final whole-branch review: Settings never loaded the
  // saved timezone/locale, so the page always showed the hardcoded defaults.
  getProfile: (profileId: string) => Promise<ProfileRecord>;
}

export interface GetProfileContext {
  profileId: string | null;
}

export interface GetProfileResult {
  status: number;
  body: Record<string, unknown>;
}

const MAX_DISPLAY_NAME_LENGTH = 60;

export async function handleUpdateProfile(
  deps: UpdateProfileDeps,
  context: UpdateProfileContext
): Promise<UpdateProfileResult> {
  if (!context.profileId) {
    return { status: 401, body: { error: 'You must be signed in.' } };
  }

  const trimmed = context.displayName.trim();
  if (trimmed.length === 0) {
    return { status: 400, body: { error: 'Display name cannot be empty.' } };
  }
  if (trimmed.length > MAX_DISPLAY_NAME_LENGTH) {
    return { status: 400, body: { error: `Display name must be ${MAX_DISPLAY_NAME_LENGTH} characters or fewer.` } };
  }

  await deps.saveDisplayName(context.profileId, trimmed);
  return { status: 200, body: { ok: true } };
}

export async function handleGetProfile(
  deps: GetProfileDeps,
  context: GetProfileContext
): Promise<GetProfileResult> {
  if (!context.profileId) {
    return { status: 401, body: { error: 'You must be signed in.' } };
  }
  const profile = await deps.getProfile(context.profileId);
  return { status: 200, body: { displayName: profile.displayName, timezone: profile.timezone, locale: profile.locale } };
}
