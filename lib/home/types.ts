// lib/home/types.ts
import type { PlatformTotals, RecapPlatform, RecapTopPost } from '@/lib/recap/types';

export type DiagnosticPlatform = 'youtube' | 'tiktok' | 'instagram';

export interface HomeDiagnosticSummary {
  id: string;
  platform: DiagnosticPlatform;
  overallScore: number;
  hookStrengthScore: number;
  retentionRiskScore: number;
  timingScore: number;
  formatFitScore: number;
  createdAt: string;
}

export interface HomeRecapSummary {
  id: string;
  month: string;
  totals: PlatformTotals;
  platformData: Partial<Record<RecapPlatform, PlatformTotals>>;
  topPost: RecapTopPost;
  generatedAt: string;
}

export interface HomeIdeasDigestSummary {
  weekStart: string;
  ideaCount: number;
  firstIdeaTitle: string;
}

export interface HomeIdeasSummary {
  niche: string | null;
  digest: HomeIdeasDigestSummary | null;
}

export interface HomeData {
  email: string;
  diagnostic: HomeDiagnosticSummary | null;
  recap: HomeRecapSummary | null;
  ideas: HomeIdeasSummary;
}
