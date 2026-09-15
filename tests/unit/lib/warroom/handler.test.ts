import { describe, it, expect } from 'vitest';
import { handleListWarroomAlerts, type WarroomHandlerDeps } from '@/lib/warroom/handler';
import type { WarroomAlertRow } from '@/lib/warroom/types';

function makeDeps(overrides: Partial<WarroomHandlerDeps> = {}): WarroomHandlerDeps {
  return {
    hasActiveSubscription: async () => true,
    getRecentAlerts: async () => [],
    setEmailOptIn: async () => {},
    ...overrides,
  };
}

describe('handleListWarroomAlerts', () => {
  it('rejects a signed-out request', async () => {
    const result = await handleListWarroomAlerts(makeDeps(), { profileId: null });
    expect(result.status).toBe(401);
  });

  it('rejects a signed-in profile with no active subscription', async () => {
    const deps = makeDeps({ hasActiveSubscription: async () => false });
    const result = await handleListWarroomAlerts(deps, { profileId: 'p1' });
    expect(result.status).toBe(402);
    expect(result.body.upgradeUrl).toBe('/billing');
  });

  it('returns the recent alerts for a subscribed profile', async () => {
    const alert: WarroomAlertRow = {
      id: 'a1',
      platform: 'youtube',
      externalPostId: 'v1',
      url: 'https://example.com',
      captionOrTitle: 'GTA 6 news',
      viewCount: 300000,
      engagementCount: 1000,
      publishedAt: '2026-09-15T10:00:00Z',
      severity: 'already_viral',
      detectedAt: '2026-09-15T11:00:00Z',
    };
    const deps = makeDeps({ getRecentAlerts: async () => [alert] });
    const result = await handleListWarroomAlerts(deps, { profileId: 'p1' });
    expect(result.status).toBe(200);
    expect(result.body.alerts).toEqual([alert]);
  });
});
