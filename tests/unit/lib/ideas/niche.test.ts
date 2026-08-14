import { describe, it, expect, vi } from 'vitest';
import { saveNiche } from '@/lib/ideas/niche';

describe('saveNiche', () => {
  it('rejects an empty or whitespace-only niche', async () => {
    const updateProfileNiche = vi.fn();
    const result = await saveNiche({ updateProfileNiche }, { profileId: 'p1', niche: '   ' });
    expect(result.status).toBe(400);
    expect(updateProfileNiche).not.toHaveBeenCalled();
  });

  it('rejects a niche over 200 characters', async () => {
    const updateProfileNiche = vi.fn();
    const result = await saveNiche({ updateProfileNiche }, { profileId: 'p1', niche: 'x'.repeat(201) });
    expect(result.status).toBe(400);
    expect(updateProfileNiche).not.toHaveBeenCalled();
  });

  it('trims and saves a valid niche', async () => {
    const updateProfileNiche = vi.fn().mockResolvedValue(undefined);
    const result = await saveNiche({ updateProfileNiche }, { profileId: 'p1', niche: '  home baking  ' });
    expect(result.status).toBe(200);
    expect(updateProfileNiche).toHaveBeenCalledWith('p1', 'home baking');
  });
});
