import { describe, it, expect, vi } from 'vitest';
import { handleUpdateLocale, ALLOWED_LOCALES, type UpdateLocaleDeps } from '@/lib/settings/locale-handler';

function makeDeps(overrides: Partial<UpdateLocaleDeps> = {}): UpdateLocaleDeps {
  return { saveLocale: vi.fn().mockResolvedValue(undefined), ...overrides };
}

describe('handleUpdateLocale', () => {
  it('returns 401 when not signed in', async () => {
    const result = await handleUpdateLocale(makeDeps(), { profileId: null, timezone: undefined, locale: undefined });
    expect(result.status).toBe(401);
  });

  it('returns 400 for an unrecognized timezone', async () => {
    const result = await handleUpdateLocale(makeDeps(), {
      profileId: 'profile-1',
      timezone: 'Not/A_Zone',
      locale: undefined,
    });
    expect(result.status).toBe(400);
  });

  it('returns 400 for a locale outside the fixed allowlist', async () => {
    const result = await handleUpdateLocale(makeDeps(), {
      profileId: 'profile-1',
      timezone: undefined,
      locale: 'xx-XX',
    });
    expect(result.status).toBe(400);
  });

  it('saves a valid timezone only, leaving locale untouched', async () => {
    const saveLocale = vi.fn().mockResolvedValue(undefined);
    const result = await handleUpdateLocale(makeDeps({ saveLocale }), {
      profileId: 'profile-1',
      timezone: 'America/Los_Angeles',
      locale: undefined,
    });
    expect(result.status).toBe(200);
    expect(saveLocale).toHaveBeenCalledWith('profile-1', { timezone: 'America/Los_Angeles', locale: undefined });
  });

  it('saves a valid locale from the fixed allowlist', async () => {
    const saveLocale = vi.fn().mockResolvedValue(undefined);
    const result = await handleUpdateLocale(makeDeps({ saveLocale }), {
      profileId: 'profile-1',
      timezone: undefined,
      locale: ALLOWED_LOCALES[0],
    });
    expect(result.status).toBe(200);
    expect(saveLocale).toHaveBeenCalledWith('profile-1', { timezone: undefined, locale: ALLOWED_LOCALES[0] });
  });
});
