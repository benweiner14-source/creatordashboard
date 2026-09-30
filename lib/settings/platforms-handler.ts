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
    },
  };
}

export interface UpdateYoutubeHandleDeps {
  saveYoutubeHandle: (profileId: string, handle: string | null) => Promise<void>;
}

export interface UpdateYoutubeHandleContext {
  profileId: string | null;
  handle: string | null;
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

  const trimmed = context.handle && context.handle.trim().length > 0 ? context.handle.trim() : null;
  await deps.saveYoutubeHandle(context.profileId, trimmed);
  return { status: 200, body: { ok: true } };
}
