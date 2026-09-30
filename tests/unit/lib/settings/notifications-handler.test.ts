import { describe, it, expect, vi } from 'vitest';
import { handleUpdateNotifications, type UpdateNotificationsDeps } from '@/lib/settings/notifications-handler';

describe('handleUpdateNotifications', () => {
  it('returns 401 when not signed in', async () => {
    const result = await handleUpdateNotifications({ savePreferences: vi.fn() }, { profileId: null, updates: {} });
    expect(result.status).toBe(401);
  });

  it('saves a partial update of known keys only', async () => {
    const savePreferences = vi.fn().mockResolvedValue(undefined);
    const result = await handleUpdateNotifications(
      { savePreferences },
      { profileId: 'profile-1', updates: { weeklyRecapReady: false, productMarketing: true } }
    );
    expect(result.status).toBe(200);
    expect(savePreferences).toHaveBeenCalledWith('profile-1', { weekly_recap_ready: false, product_marketing: true });
  });

  it('ignores unrecognized keys rather than saving them', async () => {
    const savePreferences = vi.fn().mockResolvedValue(undefined);
    const result = await handleUpdateNotifications(
      { savePreferences },
      { profileId: 'profile-1', updates: { notARealKey: true } as never }
    );
    expect(result.status).toBe(200);
    expect(savePreferences).toHaveBeenCalledWith('profile-1', {});
  });
});
