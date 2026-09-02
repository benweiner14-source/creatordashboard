export interface ChannelPost {
  captionOrTitle: string;
  publishedAt: string;
  durationSeconds: number;
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
  averageDurationSeconds: number;
  shortPct: number;
  mediumPct: number;
  longPct: number;
}
