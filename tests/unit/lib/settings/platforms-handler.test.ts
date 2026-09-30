import { describe, it, expect, vi } from 'vitest';
import {
  handleGetPlatforms,
  handleUpdateYoutubeHandle,
  type GetPlatformsDeps,
  type UpdateYoutubeHandleDeps,
} from '@/lib/settings/platforms-handler';

describe('handleGetPlatforms', () => {
  it('returns 401 when not signed in', async () => {
    const result = await handleGetPlatforms(
      { getConnectedPlatforms: vi.fn(), getYoutubeHandle: vi.fn() },
      { profileId: null }
    );
    expect(result.status).toBe(401);
  });

  it('reports connected status per platform without checking any subscription', async () => {
    const getConnectedPlatforms = vi.fn().mockResolvedValue(['tiktok']);
    const getYoutubeHandle = vi.fn().mockResolvedValue('@creator');
    const deps: GetPlatformsDeps = { getConnectedPlatforms, getYoutubeHandle };

    const result = await handleGetPlatforms(deps, { profileId: 'profile-1' });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ tiktok: true, instagram: false, youtube: true, youtubeHandle: '@creator' });
    expect(getConnectedPlatforms).toHaveBeenCalledWith('profile-1');
  });

  it('reports youtube as not connected when no handle is set', async () => {
    const deps: GetPlatformsDeps = {
      getConnectedPlatforms: vi.fn().mockResolvedValue([]),
      getYoutubeHandle: vi.fn().mockResolvedValue(null),
    };
    const result = await handleGetPlatforms(deps, { profileId: 'profile-1' });
    expect(result.body).toEqual({ tiktok: false, instagram: false, youtube: false, youtubeHandle: null });
  });

  it('includes the real youtubeHandle string alongside the boolean, so a client can populate a controlled input without wiping it', async () => {
    const deps: GetPlatformsDeps = {
      getConnectedPlatforms: vi.fn().mockResolvedValue([]),
      getYoutubeHandle: vi.fn().mockResolvedValue('@realhandle'),
    };
    const result = await handleGetPlatforms(deps, { profileId: 'profile-1' });
    expect(result.body.youtube).toBe(true);
    expect(result.body.youtubeHandle).toBe('@realhandle');
  });
});

describe('handleUpdateYoutubeHandle', () => {
  it('returns 401 when not signed in', async () => {
    const result = await handleUpdateYoutubeHandle({ saveYoutubeHandle: vi.fn() }, { profileId: null, handle: '@x' });
    expect(result.status).toBe(401);
  });

  it('saves a trimmed handle', async () => {
    const saveYoutubeHandle = vi.fn().mockResolvedValue(undefined);
    const deps: UpdateYoutubeHandleDeps = { saveYoutubeHandle };
    const result = await handleUpdateYoutubeHandle(deps, { profileId: 'profile-1', handle: '  @creator  ' });
    expect(result.status).toBe(200);
    expect(saveYoutubeHandle).toHaveBeenCalledWith('profile-1', '@creator');
  });

  it('saves null to disconnect', async () => {
    const saveYoutubeHandle = vi.fn().mockResolvedValue(undefined);
    const result = await handleUpdateYoutubeHandle({ saveYoutubeHandle }, { profileId: 'profile-1', handle: null });
    expect(result.status).toBe(200);
    expect(saveYoutubeHandle).toHaveBeenCalledWith('profile-1', null);
  });

  it('treats an explicit empty string as a real disconnect intent', async () => {
    const saveYoutubeHandle = vi.fn().mockResolvedValue(undefined);
    const result = await handleUpdateYoutubeHandle({ saveYoutubeHandle }, { profileId: 'profile-1', handle: '' });
    expect(result.status).toBe(200);
    expect(saveYoutubeHandle).toHaveBeenCalledWith('profile-1', null);
  });

  it('rejects a missing handle field with 400 instead of silently disconnecting', async () => {
    const saveYoutubeHandle = vi.fn();
    const result = await handleUpdateYoutubeHandle({ saveYoutubeHandle }, { profileId: 'profile-1', handle: undefined });
    expect(result.status).toBe(400);
    expect(saveYoutubeHandle).not.toHaveBeenCalled();
  });

  it('rejects a malformed (non-string, non-null) handle field with 400', async () => {
    const saveYoutubeHandle = vi.fn();
    const result = await handleUpdateYoutubeHandle({ saveYoutubeHandle }, { profileId: 'profile-1', handle: 42 });
    expect(result.status).toBe(400);
    expect(saveYoutubeHandle).not.toHaveBeenCalled();
  });
});
