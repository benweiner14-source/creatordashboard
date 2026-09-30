export function formatDateInTimezone(iso: string, timezone: string, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: timezone }).format(new Date(iso));
}
