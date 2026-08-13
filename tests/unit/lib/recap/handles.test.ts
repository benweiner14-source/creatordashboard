import { describe, it, expect, vi } from 'vitest';
import { normalizeHandle, saveRecapHandles } from '@/lib/recap/handles';

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
});
