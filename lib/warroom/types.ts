export type WarroomPlatform = 'youtube' | 'tiktok' | 'instagram';
export type WarroomSeverity = 'heating_up' | 'going_viral' | 'already_viral';

export interface DiscoveredPost {
  platform: WarroomPlatform;
  externalPostId: string;
  url: string;
  captionOrTitle: string;
  viewCount: number;
  engagementCount: number;
  publishedAt: string; // ISO 8601
  // Set by the curated-profile "big account" discovery clients
  // (discovery/big-accounts.ts); absent/false for standard hashtag/keyword
  // discovery. Scoring-input only, not a warroom_alerts column — dropped
  // when the row is inserted (app/api/cron/warroom/route.ts).
  isBigAccount?: boolean;
}

/**
 * What a discovery client returns: the posts it successfully normalized,
 * plus any non-benign error strings it encountered (e.g. an Apify
 * budget-exhaustion message embedded in a dataset item rather than
 * surfaced as an HTTP failure). `errors` is always `[]` for a clean run —
 * every discovery client returns this same shape so the cron handler can
 * treat all three platforms uniformly instead of special-casing one.
 */
export interface DiscoveryResult {
  posts: DiscoveredPost[];
  errors: string[];
}

export interface WarroomAlertRow extends DiscoveredPost {
  id: string;
  severity: WarroomSeverity;
  detectedAt: string;
}
