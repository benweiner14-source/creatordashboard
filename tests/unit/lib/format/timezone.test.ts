import { describe, it, expect } from 'vitest';
import { formatDateInTimezone } from '@/lib/format/timezone';

describe('formatDateInTimezone', () => {
  it('formats a date in the given timezone', () => {
    // 2026-09-19T01:00:00Z is Sept 18 evening in Los Angeles (UTC-7 in September, DST)
    const result = formatDateInTimezone('2026-09-19T01:00:00Z', 'America/Los_Angeles', {
      month: 'long',
      day: 'numeric',
    });
    expect(result).toBe('September 18');
  });

  it('formats the same instant differently in a different timezone', () => {
    const result = formatDateInTimezone('2026-09-19T01:00:00Z', 'Asia/Tokyo', { month: 'long', day: 'numeric' });
    expect(result).toBe('September 19');
  });
});
