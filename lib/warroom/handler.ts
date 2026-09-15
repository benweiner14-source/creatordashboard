import type { WarroomAlertRow } from './types';

export interface WarroomHandlerDeps {
  hasActiveSubscription: (profileId: string) => Promise<boolean>;
  getRecentAlerts: () => Promise<WarroomAlertRow[]>;
  setEmailOptIn: (profileId: string, optIn: boolean) => Promise<void>;
}

export interface WarroomHandlerResult {
  status: number;
  body: Record<string, unknown>;
}

export async function handleListWarroomAlerts(
  deps: WarroomHandlerDeps,
  context: { profileId: string | null }
): Promise<WarroomHandlerResult> {
  if (!context.profileId) {
    return { status: 401, body: { error: 'You must be signed in to view the War Room.' } };
  }
  if (!(await deps.hasActiveSubscription(context.profileId))) {
    return { status: 402, body: { error: 'GTA6 War Room requires an active subscription.', upgradeUrl: '/billing' } };
  }
  const alerts = await deps.getRecentAlerts();
  return { status: 200, body: { alerts } };
}
