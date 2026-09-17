const CLAUDE_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';

export type ClaudeContentBlock =
  | { type: 'text'; text: string }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } }
  | { type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg'; data: string } };

/**
 * The <niche>/<target_goal> containment tags the LinkedIn clients wrap free
 * text in are a real security measure, not decoration — a niche value
 * containing a literal "</niche>" must not be able to close the tag early and
 * inject text at the top level of the prompt. Neutralize angle brackets in the
 * interpolated values (never the literal tags themselves) before they go into
 * the template.
 */
export function escapeForContainmentTag(value: string): string {
  return value.replace(/</g, '‹').replace(/>/g, '›');
}

export interface ClaudeJsonRequest {
  apiKey: string;
  model: string;
  maxTokens: number;
  system: string;
  userContent: string | ClaudeContentBlock[];
}

/**
 * Shared fetch + code-fence strip + JSON parse for the single-turn Claude
 * clients that ask for a small JSON object back (lib/integrations/claude.ts,
 * lib/integrations/claude-strategy.ts, and the lib/integrations/claude-linkedin-*.ts
 * clients). `userContent` accepts either a plain string or a content-block
 * array (a text block plus a PDF `document` block, used by
 * claude-linkedin-audit.ts) — deliberately not used by claude-ideas.ts, whose
 * response comes back through web-search tool use as a fenced array spread
 * over several text blocks.
 */
export async function requestClaudeJson<T>(request: ClaudeJsonRequest): Promise<T> {
  const response = await fetch(CLAUDE_MESSAGES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': request.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: request.model,
      max_tokens: request.maxTokens,
      system: request.system,
      messages: [{ role: 'user', content: request.userContent }],
    }),
  });
  if (!response.ok) {
    throw new Error(`Claude API request failed with status ${response.status}`);
  }
  const data = await response.json();
  // A truncated response fails JSON.parse for a reason that has nothing to do
  // with the model refusing or misformatting — say so honestly instead of
  // blaming the parse.
  if (data.stop_reason === 'max_tokens') {
    throw new Error('Claude API response was truncated (hit the token limit) before it could be parsed.');
  }
  const text = data.content?.[0]?.text ?? '{}';
  try {
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
    return JSON.parse(cleaned) as T;
  } catch {
    throw new Error('Claude API returned a response that could not be parsed as JSON.');
  }
}
