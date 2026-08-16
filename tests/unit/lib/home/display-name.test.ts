import { describe, it, expect } from 'vitest';
import { deriveDisplayNameFromEmail } from '@/lib/home/display-name';

describe('deriveDisplayNameFromEmail', () => {
  it('capitalizes the first letter of the local part', () => {
    expect(deriveDisplayNameFromEmail('jordan@example.com')).toBe('Jordan');
  });

  it('leaves the rest of the local part unchanged', () => {
    expect(deriveDisplayNameFromEmail('jordan.reyes@example.com')).toBe('Jordan.reyes');
  });

  it('handles a single-character local part', () => {
    expect(deriveDisplayNameFromEmail('j@example.com')).toBe('J');
  });

  it('leaves an already-capitalized local part unchanged', () => {
    expect(deriveDisplayNameFromEmail('Jordan@example.com')).toBe('Jordan');
  });

  it('falls back to "there" for an email with no local part', () => {
    expect(deriveDisplayNameFromEmail('@example.com')).toBe('there');
  });
});
