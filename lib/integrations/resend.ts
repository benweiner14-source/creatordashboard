export interface EmailClient {
  sendEmail(params: { to: string; subject: string; html: string }): Promise<void>;
}

/**
 * Plain fetch against Resend's REST API — no SDK dependency, matching every
 * other external integration in this codebase. See
 * docs/superpowers/specs/2026-08-15-weekly-digest-delivery-design.md §4.
 */
export function createResendEmailClient(apiKey: string, from: string): EmailClient {
  return {
    async sendEmail({ to, subject, html }): Promise<void> {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ from, to, subject, html }),
      });
      if (!response.ok) {
        throw new Error(`Resend API request failed with status ${response.status}`);
      }
    },
  };
}
