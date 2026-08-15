import { describe, it, expect, vi } from 'vitest';
import { saveDigestOptIn } from '@/lib/digest/opt-in';

describe('saveDigestOptIn', () => {
  it('rejects turning on without a niche set, and does not save', async () => {
    const updateDigestOptIn = vi.fn();
    const result = await saveDigestOptIn(
      { getProfileNiche: async () => null, updateDigestOptIn },
      { profileId: 'p1', optIn: true }
    );
    expect(result.status).toBe(400);
    expect(updateDigestOptIn).not.toHaveBeenCalled();
  });

  it('allows turning on when a niche is set', async () => {
    const updateDigestOptIn = vi.fn().mockResolvedValue(undefined);
    const result = await saveDigestOptIn(
      { getProfileNiche: async () => 'home baking', updateDigestOptIn },
      { profileId: 'p1', optIn: true }
    );
    expect(result.status).toBe(200);
    expect(updateDigestOptIn).toHaveBeenCalledWith('p1', true);
  });

  it('always allows turning off, even without a niche set', async () => {
    const getProfileNiche = vi.fn().mockResolvedValue(null);
    const updateDigestOptIn = vi.fn().mockResolvedValue(undefined);
    const result = await saveDigestOptIn({ getProfileNiche, updateDigestOptIn }, { profileId: 'p1', optIn: false });
    expect(result.status).toBe(200);
    expect(updateDigestOptIn).toHaveBeenCalledWith('p1', false);
  });
});
