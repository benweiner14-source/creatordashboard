const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole calendar days between `from` and `now`, floored — not a rolling 24h window. */
function daysBetween(from: Date, now: Date): number {
  const fromDay = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const nowDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((nowDay - fromDay) / DAY_MS);
}

export function formatRelativeDays(from: Date, now: Date): string {
  const days = Math.max(0, daysBetween(from, now));
  if (days === 0) return 'today';
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  const weeks = Math.round(days / 7);
  return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
}

function trimTrailingZero(value: string): string {
  return value.endsWith('.0') ? value.slice(0, -2) : value;
}

export function formatCompactNumber(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${trimTrailingZero((n / 1000).toFixed(1))}K`;
  return `${trimTrailingZero((n / 1_000_000).toFixed(1))}M`;
}
