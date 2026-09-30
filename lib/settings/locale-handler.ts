// Matches the five options in app/settings/page.tsx's Language <select>.
export const ALLOWED_LOCALES = ['en-US', 'en-GB', 'es-ES', 'pt-BR', 'de-DE'] as const;

export interface UpdateLocaleDeps {
  saveLocale: (profileId: string, params: { timezone?: string; locale?: string }) => Promise<void>;
}

export interface UpdateLocaleContext {
  profileId: string | null;
  timezone: string | undefined;
  locale: string | undefined;
}

export interface UpdateLocaleResult {
  status: number;
  body: Record<string, unknown>;
}

function isValidTimezone(value: string): boolean {
  try {
    return Intl.supportedValuesOf('timeZone').includes(value);
  } catch {
    return false;
  }
}

export async function handleUpdateLocale(deps: UpdateLocaleDeps, context: UpdateLocaleContext): Promise<UpdateLocaleResult> {
  if (!context.profileId) {
    return { status: 401, body: { error: 'You must be signed in.' } };
  }
  if (context.timezone !== undefined && !isValidTimezone(context.timezone)) {
    return { status: 400, body: { error: 'Unrecognized timezone.' } };
  }
  if (context.locale !== undefined && !(ALLOWED_LOCALES as readonly string[]).includes(context.locale)) {
    return { status: 400, body: { error: 'Unrecognized language.' } };
  }

  await deps.saveLocale(context.profileId, { timezone: context.timezone, locale: context.locale });
  return { status: 200, body: { ok: true } };
}
