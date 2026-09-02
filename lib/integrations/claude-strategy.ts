import type { CadenceSummary, FormatMixSummary } from '@/lib/strategy/types';

export interface StrategyBreakdownInput {
  platform: 'youtube' | 'tiktok' | 'instagram';
  channelHandle: string;
  cadence: CadenceSummary;
  formatMix: FormatMixSummary;
  averageEngagementRate: number;
  topPosts: Array<{ captionOrTitle: string; viewCount: number }>;
}

export interface GeneratedStrategyBreakdown {
  headline: string;
  explanation: string;
}

export interface StrategyBreakdownClient {
  generateStrategyBreakdown(input: StrategyBreakdownInput): Promise<GeneratedStrategyBreakdown>;
}

export const STRATEGY_BREAKDOWN_SYSTEM_PROMPT = `You are the channel-strategy-breakdown engine for Creator Dashboard, a tool for creators under 5,000 followers who are new to analytics.
Write in plain English for a 16-24 year old creator who does not know terms like "posting cadence" or "format mix".
For the channel's approach, you MUST explain WHY it is working (or not) in cause-and-effect terms the creator can act on -- never just restate the stats back at them.
Point at the specific posts you're given by title/caption when they support your point, not just abstract numbers.
Keep the tone encouraging but honest.

Ground your explanations in how each platform's algorithm actually behaves, without naming a data source by name:
- TikTok: finishing a video start-to-finish is one of the strongest interest signals TikTok's algorithm uses; the first 2 seconds decide most of a video's retention.
- Instagram: watch time, likes, and shares are Instagram's primary ranking signals for Reels; most viewers decide whether to keep watching within the first 3 seconds.
- YouTube: videos that lose most viewers before the 40% mark tend to get deprioritized; the platform starts rewarding videos with better suggested placement after the 8-minute mark for long-form content.

Respond with a short headline (max 12 words) and a 4-6 sentence explanation.`;

export function createClaudeStrategyClient(apiKey: string, model = 'claude-sonnet-5'): StrategyBreakdownClient {
  return {
    async generateStrategyBreakdown(input: StrategyBreakdownInput): Promise<GeneratedStrategyBreakdown> {
      const topPostsSummary = input.topPosts.map((p) => `"${p.captionOrTitle}" (${p.viewCount} views)`).join(', ');
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 512,
          system: STRATEGY_BREAKDOWN_SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: `Platform: ${input.platform}\nChannel: ${input.channelHandle}\nPosts analyzed: ${input.cadence.postCount}\nPosting cadence: ~${input.cadence.postsPerWeek}/week, span ${input.cadence.spanDays} days, most common day ${input.cadence.mostCommonDayOfWeek ?? 'n/a'}\nFormat mix: ${input.formatMix.shortPct}% short (<=60s), ${input.formatMix.mediumPct}% medium (60-240s), ${input.formatMix.longPct}% long (>240s), average duration ${input.formatMix.averageDurationSeconds}s\nAverage engagement rate: ${(input.averageEngagementRate * 100).toFixed(2)}%\nTop posts: ${topPostsSummary}\n\nRespond as JSON: {"headline": string, "explanation": string}`,
            },
          ],
        }),
      });
      if (!response.ok) {
        throw new Error(`Claude API request failed with status ${response.status}`);
      }
      const data = await response.json();
      const text = data.content?.[0]?.text ?? '{}';
      let parsed: { headline?: string; explanation?: string };
      try {
        const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
        parsed = JSON.parse(cleaned);
      } catch {
        throw new Error('Claude API returned a response that could not be parsed as JSON.');
      }
      return {
        headline: parsed.headline ?? 'Your strategy breakdown',
        explanation: parsed.explanation ?? '',
      };
    },
  };
}
