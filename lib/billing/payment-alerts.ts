export function shouldSendPastDueAlert(previousStatus: string | null, newStatus: string): boolean {
  return newStatus === 'past_due' && previousStatus !== 'past_due';
}
