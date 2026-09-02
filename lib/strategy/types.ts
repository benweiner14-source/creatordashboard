export interface ChannelPost {
  captionOrTitle: string;
  publishedAt: string;
  /**
   * Undefined when the source doesn't report a duration at all — Apify's
   * Instagram scraper only populates it for video posts, so photos and
   * carousels legitimately have no duration. Never coerce this to 0: a
   * 0-second post would be counted as a short-form video that doesn't exist.
   */
  durationSeconds?: number;
  viewCount: number;
  likeCount: number;
  commentCount: number;
}

export interface CadenceSummary {
  postCount: number;
  spanDays: number;
  postsPerWeek: number;
  mostCommonDayOfWeek: string | null;
}

export interface FormatMixSummary {
  /** Averaged over posts with a known duration only. */
  averageDurationSeconds: number;
  /** Percentages of the posts with a known duration; always sum to 100 (or all 0). */
  shortPct: number;
  mediumPct: number;
  longPct: number;
  /**
   * How many posts had no duration to bucket (Instagram photos/carousels).
   * Surfaced so the percentages above are readable as "of the posts we could
   * measure" rather than silently standing in for the whole channel.
   */
  postsWithUnknownDuration: number;
}
