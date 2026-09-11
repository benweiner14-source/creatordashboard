const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * A post published less than an hour ago uses a 1-hour floor rather than the
 * true elapsed time, so a brand-new upload doesn't produce an artificially
 * explosive (or Infinity, at t=0) views-per-hour figure.
 *
 * A missing or unparseable `publishedAt` returns 0 rather than NaN: NaN
 * poisons a descending sort and, once JSON.stringify'd into a stored column,
 * can land as `null` in a field typed `number`. 0 sorts the post to the
 * bottom, which is the honest place for a post we can't date.
 */
export function computeViewsPerHour(viewCount: number, publishedAt: string, now: Date = new Date()): number {
  const publishedMs = new Date(publishedAt).getTime();
  if (!Number.isFinite(publishedMs)) return 0;
  const hoursElapsed = Math.max((now.getTime() - publishedMs) / MS_PER_HOUR, 1);
  return viewCount / hoursElapsed;
}
