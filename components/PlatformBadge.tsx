export type BadgePlatform = 'youtube' | 'tiktok' | 'instagram';

const PLATFORM_CONFIG: Record<BadgePlatform, { label: string; className: string }> = {
  youtube: { label: 'YouTube', className: 'bg-[#e5342a]' },
  tiktok: { label: 'TikTok', className: 'bg-[#121212]' },
  instagram: {
    label: 'Instagram',
    className: 'bg-[linear-gradient(135deg,#f6a34d_0%,#dd2a7b_55%,#7b3fe4_100%)]',
  },
};

export interface PlatformBadgeProps {
  platform: BadgePlatform;
}

export function PlatformBadge({ platform }: PlatformBadgeProps) {
  const config = PLATFORM_CONFIG[platform];

  return (
    <span
      role="img"
      aria-label={config.label}
      className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-white ring-2 ring-white ${config.className}`}
    >
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4">
        {platform === 'youtube' && <path d="M9 7.5v9l7.5-4.5L9 7.5z" fill="currentColor" />}
        {platform === 'tiktok' && (
          <path
            d="M14 5c.4 2 1.8 3.4 3.8 3.6v2.5c-1.4 0-2.7-.4-3.8-1.2v5.4a4.7 4.7 0 1 1-4.7-4.7c.3 0 .6 0 .9.1v2.6a2.1 2.1 0 1 0 1.5 2V5H14z"
            fill="currentColor"
          />
        )}
        {platform === 'instagram' && (
          <rect x="4" y="4" width="16" height="16" rx="5" stroke="currentColor" strokeWidth="1.8" fill="none" />
        )}
      </svg>
    </span>
  );
}
