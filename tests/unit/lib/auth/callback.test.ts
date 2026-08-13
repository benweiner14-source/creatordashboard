import { describe, it, expect, vi } from 'vitest';
import { handleAuthCallback, extractUrlParam, isSafeRelativePath } from '@/lib/auth/callback';

describe('isSafeRelativePath', () => {
  it('accepts a root-relative path', () => {
    expect(isSafeRelativePath('/diagnostic?url=x')).toBe(true);
  });

  it('rejects an absolute URL', () => {
    expect(isSafeRelativePath('https://evil.example')).toBe(false);
  });

  it('rejects a protocol-relative URL', () => {
    expect(isSafeRelativePath('//evil.example')).toBe(false);
  });

  it('rejects a value that does not start with a slash', () => {
    expect(isSafeRelativePath('diagnostic')).toBe(false);
  });
});

describe('extractUrlParam', () => {
  it('reads the url query param out of a path+query string', () => {
    expect(extractUrlParam('/diagnostic?url=https%3A%2F%2Ftiktok.com%2Fx')).toBe('https://tiktok.com/x');
  });

  it('returns null when there is no url param', () => {
    expect(extractUrlParam('/diagnostic')).toBeNull();
  });
});

describe('handleAuthCallback', () => {
  it('redirects to the next path when code exchange succeeds', async () => {
    const exchangeCodeForSession = vi.fn().mockResolvedValue({ error: null });
    const result = await handleAuthCallback(
      { exchangeCodeForSession },
      { code: 'valid-code', next: '/diagnostic?url=https%3A%2F%2Ftiktok.com%2Fx', origin: 'https://app.example.com' }
    );
    expect(exchangeCodeForSession).toHaveBeenCalledWith('valid-code');
    expect(result.redirectUrl).toBe('https://app.example.com/diagnostic?url=https%3A%2F%2Ftiktok.com%2Fx');
  });

  it('redirects to /diagnostic with authError=expired and the preserved url when code exchange fails', async () => {
    const exchangeCodeForSession = vi.fn().mockResolvedValue({ error: { message: 'expired' } });
    const result = await handleAuthCallback(
      { exchangeCodeForSession },
      { code: 'stale-code', next: '/diagnostic?url=https%3A%2F%2Ftiktok.com%2Fx', origin: 'https://app.example.com' }
    );
    const redirectUrl = new URL(result.redirectUrl);
    expect(redirectUrl.pathname).toBe('/diagnostic');
    expect(redirectUrl.searchParams.get('authError')).toBe('expired');
    expect(redirectUrl.searchParams.get('url')).toBe('https://tiktok.com/x');
  });

  it('redirects to /diagnostic with authError=expired and no url when there is no code at all', async () => {
    const exchangeCodeForSession = vi.fn();
    const result = await handleAuthCallback(
      { exchangeCodeForSession },
      { code: null, next: '/diagnostic', origin: 'https://app.example.com' }
    );
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    const redirectUrl = new URL(result.redirectUrl);
    expect(redirectUrl.searchParams.get('authError')).toBe('expired');
    expect(redirectUrl.searchParams.has('url')).toBe(false);
  });

  it('falls back to /diagnostic on the app origin when next is an absolute URL (open-redirect guard)', async () => {
    const exchangeCodeForSession = vi.fn().mockResolvedValue({ error: null });
    const result = await handleAuthCallback(
      { exchangeCodeForSession },
      { code: 'valid-code', next: 'https://evil.example', origin: 'https://app.example.com' }
    );
    const redirectUrl = new URL(result.redirectUrl);
    expect(redirectUrl.origin).toBe('https://app.example.com');
    expect(redirectUrl.pathname).toBe('/diagnostic');
  });

  it('falls back to /diagnostic without throwing when next is malformed', async () => {
    const exchangeCodeForSession = vi.fn().mockResolvedValue({ error: null });
    const result = await handleAuthCallback(
      { exchangeCodeForSession },
      { code: 'valid-code', next: 'http://', origin: 'https://app.example.com' }
    );
    const redirectUrl = new URL(result.redirectUrl);
    expect(redirectUrl.origin).toBe('https://app.example.com');
    expect(redirectUrl.pathname).toBe('/diagnostic');
  });
});
