import type { EmailClient } from '@/lib/integrations/resend';

export interface SentEmail {
  to: string;
  subject: string;
  html: string;
}

export function createFakeEmailClient(): { client: EmailClient; sent: SentEmail[] } {
  const sent: SentEmail[] = [];
  return {
    sent,
    client: {
      async sendEmail(params) {
        sent.push(params);
      },
    },
  };
}
