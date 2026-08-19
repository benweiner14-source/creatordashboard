export type BillingStatusData =
  | { status: 'free' }
  | { status: 'active' | 'past_due'; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean };

export type BillingPageState =
  | { status: 'loading' }
  | { status: 'polling' }
  | { status: 'free'; justCheckedOut?: boolean }
  | { status: 'subscribed'; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; pastDue: boolean }
  | { status: 'bootstrapFailed' };

export type BillingPageEvent =
  | { type: 'START_POLLING' }
  | { type: 'BOOTSTRAPPED'; data: BillingStatusData }
  | { type: 'POLL_EXHAUSTED' }
  | { type: 'BOOTSTRAP_FAILED' };

export function createInitialBillingPageState(): BillingPageState {
  return { status: 'loading' };
}

export function billingPageReducer(state: BillingPageState, event: BillingPageEvent): BillingPageState {
  switch (event.type) {
    case 'START_POLLING':
      return { status: 'polling' };

    case 'BOOTSTRAPPED':
      if (event.data.status === 'free') {
        return { status: 'free' };
      }
      return {
        status: 'subscribed',
        currentPeriodEnd: event.data.currentPeriodEnd,
        cancelAtPeriodEnd: event.data.cancelAtPeriodEnd,
        pastDue: event.data.status === 'past_due',
      };

    case 'POLL_EXHAUSTED':
      return { status: 'free', justCheckedOut: true };

    case 'BOOTSTRAP_FAILED':
      return { status: 'bootstrapFailed' };

    default:
      return state;
  }
}
