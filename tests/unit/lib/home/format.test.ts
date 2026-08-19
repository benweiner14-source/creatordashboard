import { describe, it, expect } from 'vitest';
import { formatRelativeDays, formatCompactNumber } from '@/lib/home/format';

describe('formatRelativeDays', () => {
  const now = new Date('2026-08-16T12:00:00Z');

  it('returns "today" for the same calendar day', () => {
    expect(formatRelativeDays(new Date('2026-08-16T01:00:00Z'), now)).toBe('today');
  });

  it('returns "1 day ago" for yesterday', () => {
    expect(formatRelativeDays(new Date('2026-08-15T12:00:00Z'), now)).toBe('1 day ago');
  });

  it('returns "N days ago" under a week', () => {
    expect(formatRelativeDays(new Date('2026-08-13T12:00:00Z'), now)).toBe('3 days ago');
  });

  it('returns "1 week ago" for exactly 7 days', () => {
    expect(formatRelativeDays(new Date('2026-08-09T12:00:00Z'), now)).toBe('1 week ago');
  });

  it('returns "N weeks ago" for multiple weeks', () => {
    expect(formatRelativeDays(new Date('2026-07-26T12:00:00Z'), now)).toBe('3 weeks ago');
  });
});

describe('formatCompactNumber', () => {
  it('passes through numbers under 1000 unchanged', () => {
    expect(formatCompactNumber(999)).toBe('999');
    expect(formatCompactNumber(0)).toBe('0');
  });

  it('formats thousands with one decimal, trimming a trailing .0', () => {
    expect(formatCompactNumber(1500)).toBe('1.5K');
    expect(formatCompactNumber(142000)).toBe('142K');
    expect(formatCompactNumber(1000)).toBe('1K');
  });

  it('formats millions with one decimal, trimming a trailing .0', () => {
    expect(formatCompactNumber(1200000)).toBe('1.2M');
    expect(formatCompactNumber(2000000)).toBe('2M');
  });
});
