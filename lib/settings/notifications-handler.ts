export interface NotificationUpdates {
  weeklyRecapReady?: boolean;
  newContentIdeasReady?: boolean;
  diagnosticFinished?: boolean;
  productMarketing?: boolean;
  paymentBillingAlerts?: boolean;
}

const KEY_MAP: Record<keyof NotificationUpdates, string> = {
  weeklyRecapReady: 'weekly_recap_ready',
  newContentIdeasReady: 'new_content_ideas_ready',
  diagnosticFinished: 'diagnostic_finished',
  productMarketing: 'product_marketing',
  paymentBillingAlerts: 'payment_billing_alerts',
};

export interface UpdateNotificationsDeps {
  savePreferences: (profileId: string, columns: Record<string, boolean>) => Promise<void>;
}

export interface UpdateNotificationsContext {
  profileId: string | null;
  updates: NotificationUpdates;
}

export interface UpdateNotificationsResult {
  status: number;
  body: Record<string, unknown>;
}

export async function handleUpdateNotifications(
  deps: UpdateNotificationsDeps,
  context: UpdateNotificationsContext
): Promise<UpdateNotificationsResult> {
  if (!context.profileId) {
    return { status: 401, body: { error: 'You must be signed in.' } };
  }

  const columns: Record<string, boolean> = {};
  for (const key of Object.keys(KEY_MAP) as Array<keyof NotificationUpdates>) {
    const value = context.updates[key];
    if (typeof value === 'boolean') {
      columns[KEY_MAP[key]] = value;
    }
  }

  await deps.savePreferences(context.profileId, columns);
  return { status: 200, body: { ok: true } };
}
