export function deriveDisplayNameFromEmail(email: string): string {
  const localPart = email.split('@')[0] ?? '';
  if (!localPart) return 'there';
  return localPart.charAt(0).toUpperCase() + localPart.slice(1);
}
