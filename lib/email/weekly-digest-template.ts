import type { ContentIdea } from '@/lib/integrations/claude-ideas';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Plain, inline-styled HTML — no external stylesheet (required for email
 * client compatibility) and no templating dependency, matching this app's
 * pattern of hand-rolling every integration rather than adding a library.
 * See docs/superpowers/specs/2026-08-15-weekly-digest-delivery-design.md §4.
 */
export function renderWeeklyDigestEmail(params: {
  niche: string;
  weekStart: string;
  ideas: ContentIdea[];
  unsubscribeUrl: string;
}): { subject: string; html: string } {
  const subject = `Your content ideas for the week of ${params.weekStart}`;

  const ideaBlocks = params.ideas
    .map(
      (idea) => `
        <div style="margin-bottom: 24px; padding-bottom: 24px; border-bottom: 1px solid #e5e7eb;">
          <h2 style="font-size: 18px; margin: 0 0 8px;">${escapeHtml(idea.workingTitle)}</h2>
          <p style="margin: 0 0 8px; color: #374151;">${escapeHtml(idea.pitch)}</p>
          <p style="margin: 0; color: #6b7280; font-size: 14px;"><strong>Why it's hot now:</strong> ${escapeHtml(idea.whyItsHotNow)}</p>
        </div>`
    )
    .join('');

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
      <h1 style="font-size: 20px; margin: 0 0 16px;">This week's content ideas for ${escapeHtml(params.niche)}</h1>
      ${ideaBlocks}
      <p style="margin-top: 32px; font-size: 12px; color: #9ca3af;">
        <a href="${escapeHtml(params.unsubscribeUrl)}" style="color: #9ca3af;">Unsubscribe from these weekly emails</a>
      </p>
    </div>`;

  return { subject, html };
}
