import { describe, it, expect, vi } from 'vitest';
import { handleUpdateProfile, type UpdateProfileDeps, handleGetProfile, type GetProfileDeps } from '@/lib/settings/profile-handler';

function makeDeps(overrides: Partial<UpdateProfileDeps> = {}): UpdateProfileDeps {
  return {
    saveDisplayName: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('handleUpdateProfile', () => {
  it('returns 401 when not signed in', async () => {
    const result = await handleUpdateProfile(makeDeps(), { profileId: null, displayName: 'Creator' });
    expect(result.status).toBe(401);
  });

  it('returns 400 for an empty display name', async () => {
    const result = await handleUpdateProfile(makeDeps(), { profileId: 'profile-1', displayName: '   ' });
    expect(result.status).toBe(400);
  });

  it('returns 400 for a display name over 60 characters', async () => {
    const result = await handleUpdateProfile(makeDeps(), { profileId: 'profile-1', displayName: 'a'.repeat(61) });
    expect(result.status).toBe(400);
  });

  it('trims and saves a valid display name', async () => {
    const saveDisplayName = vi.fn().mockResolvedValue(undefined);
    const result = await handleUpdateProfile(makeDeps({ saveDisplayName }), {
      profileId: 'profile-1',
      displayName: '  Jordan  ',
    });
    expect(result.status).toBe(200);
    expect(saveDisplayName).toHaveBeenCalledWith('profile-1', 'Jordan');
  });
});

function makeGetDeps(overrides: Partial<GetProfileDeps> = {}): GetProfileDeps {
  return {
    getDisplayName: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe('handleGetProfile', () => {
  it('returns 401 when not signed in', async () => {
    const result = await handleGetProfile(makeGetDeps(), { profileId: null });
    expect(result.status).toBe(401);
  });

  it('returns 200 with displayName when signed in', async () => {
    const getDisplayName = vi.fn().mockResolvedValue('Jordan');
    const result = await handleGetProfile(makeGetDeps({ getDisplayName }), { profileId: 'profile-1' });
    expect(result.status).toBe(200);
    expect(result.body.displayName).toBe('Jordan');
    expect(getDisplayName).toHaveBeenCalledWith('profile-1');
  });

  it('returns 200 with null displayName when no display name is set', async () => {
    const getDisplayName = vi.fn().mockResolvedValue(null);
    const result = await handleGetProfile(makeGetDeps({ getDisplayName }), { profileId: 'profile-1' });
    expect(result.status).toBe(200);
    expect(result.body.displayName).toBeNull();
  });
});
