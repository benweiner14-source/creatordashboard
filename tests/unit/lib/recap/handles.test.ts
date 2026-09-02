import { describe, it, expect, vi } from 'vitest';
import { normalizeHandle, saveRecapHandles, detectHandlePlatform } from '@/lib/recap/handles';

describe('normalizeHandle', () => {
  it('accepts a bare handle with or without a leading @', () => {
    expect(normalizeHandle('tiktok', 'creator')).toBe('creator');
    expect(normalizeHandle('tiktok', '@creator')).toBe('creator');
  });

  it('extracts the handle from a full profile URL', () => {
    expect(normalizeHandle('tiktok', 'https://www.tiktok.com/@creator')).toBe('creator');
    expect(normalizeHandle('instagram', 'https://www.instagram.com/creator/')).toBe('creator');
    expect(normalizeHandle('youtube', 'https://www.youtube.com/@creator')).toBe('creator');
  });

  it('rejects a URL for the wrong platform', () => {
    expect(normalizeHandle('tiktok', 'https://www.instagram.com/creator')).toBeNull();
  });

  it('rejects route markers that are not handles instead of storing them as one', () => {
    expect(normalizeHandle('youtube', 'https://www.youtube.com/channel/UCabc123')).toBeNull();
    expect(normalizeHandle('youtube', 'https://www.youtube.com/c/SomeCreator')).toBeNull();
    expect(normalizeHandle('youtube', 'https://www.youtube.com/user/foo')).toBeNull();
    expect(normalizeHandle('youtube', 'https://www.youtube.com/watch?v=abc123')).toBeNull();
    expect(normalizeHandle('instagram', 'https://www.instagram.com/p/abc123/')).toBeNull();
    expect(normalizeHandle('instagram', 'https://www.instagram.com/reel/abc123/')).toBeNull();
  });

  it('still finds the handle when a route marker follows it', () => {
    expect(normalizeHandle('tiktok', 'https://www.tiktok.com/@creator/video/123456')).toBe('creator');
    expect(normalizeHandle('youtube', 'https://www.youtube.com/@creator/shorts')).toBe('creator');
  });

  it('rejects a lookalike host that merely contains the platform domain', () => {
    expect(normalizeHandle('tiktok', 'https://tiktok.com.evil.com/@creator')).toBeNull();
    expect(normalizeHandle('instagram', 'https://evil-instagram.com/creator')).toBeNull();
  });

  it('still accepts legitimate subdomains of the platform', () => {
    expect(normalizeHandle('tiktok', 'https://www.tiktok.com/@creator')).toBe('creator');
    expect(normalizeHandle('youtube', 'https://m.youtube.com/@creator')).toBe('creator');
    expect(normalizeHandle('youtube', 'https://youtube.com/@creator')).toBe('creator');
  });

  it('rejects empty or invalid input', () => {
    expect(normalizeHandle('tiktok', '   ')).toBeNull();
    expect(normalizeHandle('tiktok', 'not a valid handle!')).toBeNull();
  });
});

describe('saveRecapHandles', () => {
  it('rejects an invalid handle before calling the update', async () => {
    const updateProfileHandles = vi.fn();
    const result = await saveRecapHandles({ updateProfileHandles }, { profileId: 'p1', tiktok: 'not a valid handle!' });
    expect(result.status).toBe(400);
    expect(updateProfileHandles).not.toHaveBeenCalled();
  });

  it('rejects when no platform is provided at all', async () => {
    const updateProfileHandles = vi.fn();
    const result = await saveRecapHandles({ updateProfileHandles }, { profileId: 'p1' });
    expect(result.status).toBe(400);
    expect(updateProfileHandles).not.toHaveBeenCalled();
  });

  it('normalizes and saves the provided handles, treating an empty string as clearing that platform', async () => {
    const updateProfileHandles = vi.fn().mockResolvedValue(undefined);
    const result = await saveRecapHandles(
      { updateProfileHandles },
      { profileId: 'p1', youtube: '@creator', tiktok: '' }
    );
    expect(result.status).toBe(200);
    expect(updateProfileHandles).toHaveBeenCalledWith('p1', { youtube: 'creator', tiktok: null });
  });

  it('rejects a profile URL whose first path segment is a route marker', async () => {
    const updateProfileHandles = vi.fn();
    const result = await saveRecapHandles(
      { updateProfileHandles },
      { profileId: 'p1', youtube: 'https://www.youtube.com/channel/UCabc123' }
    );
    expect(result.status).toBe(400);
    expect(updateProfileHandles).not.toHaveBeenCalled();
  });
});

describe('detectHandlePlatform', () => {
  it('detects the platform from a YouTube URL', () => {
    expect(detectHandlePlatform('https://www.youtube.com/@creator')).toBe('youtube');
  });

  it('detects the platform from a TikTok URL', () => {
    expect(detectHandlePlatform('https://www.tiktok.com/@creator')).toBe('tiktok');
  });

  it('detects the platform from an Instagram URL', () => {
    expect(detectHandlePlatform('https://www.instagram.com/creator/')).toBe('instagram');
  });

  it('returns null for an unrelated URL', () => {
    expect(detectHandlePlatform('https://example.com/creator')).toBeNull();
  });

  it('returns null for a lookalike host', () => {
    expect(detectHandlePlatform('https://tiktok.com.evil.com/@creator')).toBeNull();
  });

  it('returns null for a bare handle with no host to detect', () => {
    expect(detectHandlePlatform('creator')).toBeNull();
  });
});
