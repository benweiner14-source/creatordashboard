import { describe, it, expect } from 'vitest';

describe('project scaffold', () => {
  it('resolves the @ path alias to the project root', async () => {
    const mod = await import('@/lib/constants');
    expect(mod.APP_NAME).toBe('Creator Dashboard');
  });
});
