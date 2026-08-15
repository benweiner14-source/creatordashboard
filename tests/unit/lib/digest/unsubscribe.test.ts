import { describe, it, expect, vi } from 'vitest';
import { handleUnsubscribe } from '@/lib/digest/unsubscribe';

describe('handleUnsubscribe', () => {
  it('reports invalid and does not opt out when the profile id is missing', async () => {
    const setOptOut = vi.fn();
    const result = await handleUnsubscribe(
      { verifyToken: () => true, setOptOut },
      { profileId: null, token: 'abc' }
    );
    expect(result.status).toBe('invalid');
    expect(setOptOut).not.toHaveBeenCalled();
  });

  it('reports invalid and does not opt out when the token is missing', async () => {
    const setOptOut = vi.fn();
    const result = await handleUnsubscribe(
      { verifyToken: () => true, setOptOut },
      { profileId: 'p1', token: null }
    );
    expect(result.status).toBe('invalid');
    expect(setOptOut).not.toHaveBeenCalled();
  });

  it('reports invalid and does not opt out when the token fails verification', async () => {
    const setOptOut = vi.fn();
    const result = await handleUnsubscribe(
      { verifyToken: () => false, setOptOut },
      { profileId: 'p1', token: 'bad-token' }
    );
    expect(result.status).toBe('invalid');
    expect(setOptOut).not.toHaveBeenCalled();
  });

  it('opts the profile out and reports ok when the token verifies', async () => {
    const setOptOut = vi.fn().mockResolvedValue(undefined);
    const result = await handleUnsubscribe(
      { verifyToken: () => true, setOptOut },
      { profileId: 'p1', token: 'good-token' }
    );
    expect(result.status).toBe('ok');
    expect(setOptOut).toHaveBeenCalledWith('p1');
  });
});
