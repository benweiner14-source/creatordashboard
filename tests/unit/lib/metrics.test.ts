import { describe, it, expect } from 'vitest';
import { computeViewsPerHour } from '@/lib/metrics';

const NOW = new Date('2026-09-10T12:00:00Z');

describe('computeViewsPerHour', () => {
  it('divides views by hours elapsed since publishing', () => {
    expect(computeViewsPerHour(1000, '2026-09-10T02:00:00Z', NOW)).toBe(100);
  });

  it('floors elapsed time at 1 hour for a post published less than an hour ago', () => {
    expect(computeViewsPerHour(500, '2026-09-10T11:45:00Z', NOW)).toBe(500);
  });

  it('returns 0 rather than NaN for a missing or unparseable publishedAt', () => {
    // NaN would poison a descending sort and, once JSON.stringify'd into a
    // stored column, can land as null in a field typed `number`.
    expect(computeViewsPerHour(500, '', NOW)).toBe(0);
    expect(computeViewsPerHour(500, 'not a date', NOW)).toBe(0);
  });
});
