export interface GetPlatformsDeps {
  getConnectedPlatforms: (profileId: string) => Promise<Array<'tiktok' | 'instagram'>>;
  getYoutubeHandle: (profileId: string) => Promise<string | null>;
}

export interface GetPlatformsContext {
  profileId: string | null;
}

export interface GetPlatformsResult {
  status: number;
  body: Record<string, unknown>;
}

// Deliberately does NOT call hasActiveSubscription anywhere in this file —
// that was the whole bug this endpoint exists to fix. See design spec §5:
// GET /api/recap gates on subscription for its own feature; this endpoint
// answers a different question ("is my platform connected") that every
// signed-in user, free or paid, is entitled to see about their own account.
export async function handleGetPlatforms(deps: GetPlatformsDeps, context: GetPlatformsContext): Promise<GetPlatformsResult> {
  if (!context.profileId) {
    return { status: 401, body: { error: 'You must be signed in.' } };
  }

  const [connected, youtubeHandle] = await Promise.all([
    deps.getConnectedPlatforms(context.profileId),
    deps.getYoutubeHandle(context.profileId),
  ]);

  return {
    status: 200,
    body: {
      tiktok: connected.includes('tiktok'),
      instagram: connected.includes('instagram'),
      youtube: Boolean(youtubeHandle),
      // The real saved handle string, so a bootstrapping client can populate a
      // CONTROLLED input with it instead of leaving it blank (and later
      // overwriting the real value with null on an untouched blur). See
      // finding I1 in the final whole-branch review.
      youtubeHandle: youtubeHandle ?? null,
    },
  };
}

export interface UpdateYoutubeHandleDeps {
  saveYoutubeHandle: (profileId: string, handle: string | null) => Promise<void>;
}

export interface UpdateYoutubeHandleContext {
  profileId: string | null;
  // Intentionally `unknown`: the route passes the raw parsed JSON value for
  // `handle` straight through so this handler — not the route — decides what
  // counts as a valid "clear the handle" intent (explicit `null` or an empty
  // string) versus a missing/malformed field that should be rejected.
  handle: unknown;
}

export interface UpdateYoutubeHandleResult {
  status: number;
  body: Record<string, unknown>;
}

export async function handleUpdateYoutubeHandle(
  deps: UpdateYoutubeHandleDeps,
  context: UpdateYoutubeHandleContext
): Promise<UpdateYoutubeHandleResult> {
  if (!context.profileId) {
    return { status: 401, body: { error: 'You must be signed in.' } };
  }

  // A genuinely missing `handle` key (undefined) or a malformed one (any
  // non-string, non-null value) is a bad request — it is NOT the same thing
  // as an explicit `null` or `''`, which are real "disconnect" intents and
  // must keep working. Treating a missing/malformed field as an implicit
  // disconnect is exactly the bug in finding I1: a request that never meant
  // to touch the handle at all silently wiped it.
  if (context.handle !== null && typeof context.handle !== 'string') {
    return { status: 400, body: { error: 'A YouTube handle (string) or null to disconnect is required.' } };
  }

  const trimmed = context.handle && context.handle.trim().length > 0 ? context.handle.trim() : null;
  await deps.saveYoutubeHandle(context.profileId, trimmed);
  return { status: 200, body: { ok: true } };
}
