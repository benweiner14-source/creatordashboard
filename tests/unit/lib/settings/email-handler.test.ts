import { describe, it, expect, vi } from 'vitest';
import { handleChangeEmail, type ChangeEmailDeps } from '@/lib/settings/email-handler';

function makeDeps(overrides: Partial<ChangeEmailDeps> = {}): ChangeEmailDeps {
  return {
    updateEmail: vi.fn().mockResolvedValue({ error: null }),
    ...overrides,
  };
}

describe('handleChangeEmail', () => {
  it('returns 401 when not signed in', async () => {
    const result = await handleChangeEmail(makeDeps(), { profileId: null, email: 'new@example.com' });
    expect(result.status).toBe(401);
  });

  it('returns 400 for an invalid email format', async () => {
    const result = await handleChangeEmail(makeDeps(), { profileId: 'profile-1', email: 'not-an-email' });
    expect(result.status).toBe(400);
  });

  it('calls updateEmail with the trimmed address and returns confirmationSent', async () => {
    const updateEmail = vi.fn().mockResolvedValue({ error: null });
    const result = await handleChangeEmail(makeDeps({ updateEmail }), {
      profileId: 'profile-1',
      email: ' new@example.com ',
    });
    expect(updateEmail).toHaveBeenCalledWith('new@example.com');
    expect(result.status).toBe(200);
    expect(result.body.status).toBe('confirmationSent');
  });

  it('surfaces the Supabase error message when updateEmail fails', async () => {
    const deps = makeDeps({ updateEmail: vi.fn().mockResolvedValue({ error: { message: 'Email already in use.' } }) });
    const result = await handleChangeEmail(deps, { profileId: 'profile-1', email: 'new@example.com' });
    expect(result.status).toBe(400);
    expect(result.body.error).toBe('Email already in use.');
  });
});
