import { describe, it, expect } from 'vitest';
import { shouldSendPastDueAlert } from '@/lib/billing/payment-alerts';

describe('shouldSendPastDueAlert', () => {
  it('returns true when transitioning into past_due from active', () => {
    expect(shouldSendPastDueAlert('active', 'past_due')).toBe(true);
  });

  it('returns false when already past_due (avoids re-sending on webhook redelivery)', () => {
    expect(shouldSendPastDueAlert('past_due', 'past_due')).toBe(false);
  });

  it('returns false when the new status is not past_due', () => {
    expect(shouldSendPastDueAlert('active', 'active')).toBe(false);
    expect(shouldSendPastDueAlert(null, 'active')).toBe(false);
  });

  it('returns true when there was no previous row at all', () => {
    expect(shouldSendPastDueAlert(null, 'past_due')).toBe(true);
  });
});
