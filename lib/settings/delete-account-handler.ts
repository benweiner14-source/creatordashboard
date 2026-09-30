import { checkAndRecordRateLimit, type RateLimitStore } from '@/lib/rate-limit';

const GRACE_PERIOD_DAYS = 14;
const DELETE_REQUEST_LIMIT = 3;
const DELETE_REQUEST_WINDOW_DAYS = 1;

export interface DeleteAccountDeps {
  rateLimitStore: RateLimitStore;
  getActiveStripeSubscriptionId: (profileId: string) => Promise<string | null>;
  cancelStripeSubscription: (subscriptionId: string) => Promise<void>;
  scheduleDeletion: (profileId: string, deletionAt: Date) => Promise<void>;
  signOut: () => Promise<void>;
}

export interface DeleteAccountContext {
  profileId: string | null;
}

export interface DeleteAccountResult {
  status: number;
  body: Record<string, unknown>;
}

export async function handleDeleteAccountRequest(
  deps: DeleteAccountDeps,
  context: DeleteAccountContext,
  now: Date = new Date()
): Promise<DeleteAccountResult> {
  if (!context.profileId) {
    return { status: 401, body: { error: 'You must be signed in.' } };
  }

  const rateLimitResult = await checkAndRecordRateLimit({
    store: deps.rateLimitStore,
    profileId: context.profileId,
    ipHash: 'n/a',
    eventType: 'account_deletion_request',
    profileLimit: DELETE_REQUEST_LIMIT,
    ipLimit: Number.MAX_SAFE_INTEGER,
    windowDays: DELETE_REQUEST_WINDOW_DAYS,
  });
  if (!rateLimitResult.allowed) {
    return { status: 429, body: { error: 'Too many attempts. Please wait and try again.' } };
  }

  const activeSubscriptionId = await deps.getActiveStripeSubscriptionId(context.profileId);
  if (activeSubscriptionId) {
    try {
      await deps.cancelStripeSubscription(activeSubscriptionId);
    } catch {
      // Never schedule a deletion with a still-billing subscription behind
      // it — this is the one place in this feature a downstream failure
      // must block the primary action rather than being logged and
      // ignored. See design spec §8.
      return { status: 500, body: { error: 'Something went wrong canceling your subscription. Please try again.' } };
    }
  }

  const deletionAt = new Date(now.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
  await deps.scheduleDeletion(context.profileId, deletionAt);
  await deps.signOut();

  return { status: 200, body: { scheduledDeletionAt: deletionAt.toISOString() } };
}
