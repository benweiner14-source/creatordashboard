export type RecapPlatform = 'youtube' | 'tiktok' | 'instagram';

export interface RecapHandles {
  youtube: string | null;
  tiktok: string | null;
  instagram: string | null;
}

export interface AggregatablePost {
  platform: RecapPlatform;
  captionOrTitle: string;
  publishedAt: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  permalink: string;
}

export interface PlatformTotals {
  views: number;
  likes: number;
  comments: number;
  postCount: number;
}

export interface RecapTopPost {
  platform: RecapPlatform;
  captionOrTitle: string;
  viewCount: number;
  permalink: string;
}

export interface RecapAggregation {
  platformData: Partial<Record<RecapPlatform, PlatformTotals>>;
  totals: PlatformTotals;
  topPost: RecapTopPost | null;
}

export interface RecapCardRow {
  id: string;
  profileId: string;
  month: string;
  platformData: Partial<Record<RecapPlatform, PlatformTotals>>;
  totals: PlatformTotals;
  topPost: RecapTopPost;
  warnings: string[];
  generatedAt: string;
}
