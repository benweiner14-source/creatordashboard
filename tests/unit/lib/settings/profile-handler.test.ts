import { describe, it, expect, vi } from 'vitest';
import { handleUpdateProfile, type UpdateProfileDeps } from '@/lib/settings/profile-handler';

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
