import type { RecapHandles, RecapPlatform } from './types';

const HANDLE_HOSTS: Record<RecapPlatform, string[]> = {
  youtube: ['youtube.com', 'youtu.be'],
  tiktok: ['tiktok.com'],
  instagram: ['instagram.com'],
};

/**
 * Path segments that are route markers, not handles. `/channel/UCabc`,
 * `/c/SomeCreator`, `/p/abc123` and friends used to normalize to
 * "channel", "c" and "p" and get stored as the creator's handle, only
 * failing much later at generation time. Rejecting them here keeps
 * validation inline on save, as the spec requires. Resolving a
 * /channel/UC... id into a usable handle is deliberately out of scope —
 * the creator is asked for their @handle instead.
 */
const RESERVED_PATH_SEGMENTS = new Set([
  'channel',
  'c',
  'user',
  'p',
  'reel',
  'reels',
  'tv',
  'watch',
  'shorts',
  'video',
  'stories',
]);

function hostMatches(hostname: string, host: string): boolean {
  return hostname === host || hostname.endsWith(`.${host}`);
}

export function normalizeHandle(platform: RecapPlatform, rawInput: string): string | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    // Suffix match, not `includes` — otherwise tiktok.com.evil.com passes.
    if (!HANDLE_HOSTS[platform].some((host) => hostMatches(parsed.hostname, host))) return null;
    const segments = parsed.pathname.split('/').filter(Boolean);
    const atSegment = segments.find((s) => s.startsWith('@'));
    if (!atSegment) {
      const first = segments[0];
      if (!first || RESERVED_PATH_SEGMENTS.has(first.toLowerCase())) return null;
      return first;
    }
    return atSegment.replace(/^@/, '');
  } catch {
    // Not a URL — treat as a bare handle.
    const bare = trimmed.replace(/^@/, '');
    return /^[a-zA-Z0-9._-]+$/.test(bare) ? bare : null;
  }
}

export function detectHandlePlatform(url: string): RecapPlatform | null {
  try {
    const parsed = new URL(url);
    const platforms = Object.keys(HANDLE_HOSTS) as RecapPlatform[];
    return platforms.find((platform) => HANDLE_HOSTS[platform].some((host) => hostMatches(parsed.hostname, host))) ?? null;
  } catch {
    return null;
  }
}

export interface SaveHandlesDeps {
  updateProfileHandles: (profileId: string, handles: Partial<RecapHandles>) => Promise<void>;
}

export interface SaveHandlesParams {
  profileId: string;
  youtube?: string;
  tiktok?: string;
  instagram?: string;
}

export interface SaveHandlesResult {
  status: number;
  body: { ok: true } | { error: string };
}

const PLATFORMS: RecapPlatform[] = ['youtube', 'tiktok', 'instagram'];

export async function saveRecapHandles(deps: SaveHandlesDeps, params: SaveHandlesParams): Promise<SaveHandlesResult> {
  const updates: Partial<RecapHandles> = {};

  for (const platform of PLATFORMS) {
    const raw = params[platform];
    if (raw === undefined) continue;
    if (raw === '') {
      updates[platform] = null;
      continue;
    }
    const normalized = normalizeHandle(platform, raw);
    if (!normalized) {
      return { status: 400, body: { error: `That doesn't look like a valid ${platform} handle or profile URL.` } };
    }
    updates[platform] = normalized;
  }

  if (Object.keys(updates).length === 0) {
    return { status: 400, body: { error: 'At least one platform handle is required.' } };
  }

  await deps.updateProfileHandles(params.profileId, updates);
  return { status: 200, body: { ok: true } };
}
