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
    getProfile: vi.fn().mockResolvedValue({ displayName: null, timezone: null, locale: null }),
    ...overrides,
  };
}

describe('handleGetProfile', () => {
  it('returns 401 when not signed in', async () => {
    const result = await handleGetProfile(makeGetDeps(), { profileId: null });
    expect(result.status).toBe(401);
  });

  it('returns 200 with displayName when signed in', async () => {
    const getProfile = vi.fn().mockResolvedValue({ displayName: 'Jordan', timezone: null, locale: null });
    const result = await handleGetProfile(makeGetDeps({ getProfile }), { profileId: 'profile-1' });
    expect(result.status).toBe(200);
    expect(result.body.displayName).toBe('Jordan');
    expect(getProfile).toHaveBeenCalledWith('profile-1');
  });

  it('returns 200 with null displayName when no display name is set', async () => {
    const getProfile = vi.fn().mockResolvedValue({ displayName: null, timezone: null, locale: null });
    const result = await handleGetProfile(makeGetDeps({ getProfile }), { profileId: 'profile-1' });
    expect(result.status).toBe(200);
    expect(result.body.displayName).toBeNull();
  });

  it('returns the saved timezone and locale alongside displayName', async () => {
    const getProfile = vi.fn().mockResolvedValue({ displayName: 'Jordan', timezone: 'Europe/London', locale: 'en-GB' });
    const result = await handleGetProfile(makeGetDeps({ getProfile }), { profileId: 'profile-1' });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ displayName: 'Jordan', timezone: 'Europe/London', locale: 'en-GB' });
  });

  it('returns null timezone/locale when the profile has none set', async () => {
    const getProfile = vi.fn().mockResolvedValue({ displayName: null, timezone: null, locale: null });
    const result = await handleGetProfile(makeGetDeps({ getProfile }), { profileId: 'profile-1' });
    expect(result.body).toEqual({ displayName: null, timezone: null, locale: null });
  });
});
