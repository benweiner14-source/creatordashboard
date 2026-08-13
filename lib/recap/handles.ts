import type { RecapHandles, RecapPlatform } from './types';

const HANDLE_HOSTS: Record<RecapPlatform, string[]> = {
  youtube: ['youtube.com', 'youtu.be'],
  tiktok: ['tiktok.com'],
  instagram: ['instagram.com'],
};

export function normalizeHandle(platform: RecapPlatform, rawInput: string): string | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (!HANDLE_HOSTS[platform].some((host) => parsed.hostname.includes(host))) return null;
    const segments = parsed.pathname.split('/').filter(Boolean);
    const handleSegment = segments.find((s) => s.startsWith('@')) ?? segments[0];
    if (!handleSegment) return null;
    return handleSegment.replace(/^@/, '');
  } catch {
    // Not a URL — treat as a bare handle.
    const bare = trimmed.replace(/^@/, '');
    return /^[a-zA-Z0-9._-]+$/.test(bare) ? bare : null;
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
