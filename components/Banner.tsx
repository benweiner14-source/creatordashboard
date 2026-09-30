export type BannerVariant = 'caution' | 'info' | 'cached' | 'positive' | 'critical' | 'promo';

const VARIANT_STYLES: Record<BannerVariant, { card: string; dot: string; label: string }> = {
  caution: {
    card: 'border-[#fadf9a] border-t-[#f59e0b] bg-gradient-to-br from-[#fffbeb] to-[#fdecc8]',
    dot: 'bg-[#f59e0b]',
    label: 'text-[#b45309]',
  },
  info: {
    card: 'border-[#d6ccfb] border-t-[#8b5cf6] bg-gradient-to-br from-[#f5f3ff] to-[#e7e0ff]',
    dot: 'bg-[#8b5cf6]',
    label: 'text-[#6d28d9]',
  },
  cached: {
    card: 'border-[#b6ddfb] border-t-[#0ea5e9] bg-gradient-to-br from-[#f0f9ff] to-[#dbeafe]',
    dot: 'bg-[#0ea5e9]',
    label: 'text-[#0369a1]',
  },
  positive: {
    card: 'border-[#a7f3d0] border-t-[#10b981] bg-gradient-to-br from-[#ecfdf5] to-[#d1fae5]',
    dot: 'bg-[#10b981]',
    label: 'text-[#047857]',
  },
  critical: {
    card: 'border-[#f7cfc8] border-t-[#ef4444] bg-gradient-to-br from-[#fef2f2] to-[#fde4e0]',
    dot: 'bg-[#ef4444]',
    label: 'text-[#b91c1c]',
  },
  promo: {
    // Repo's brand gradient (magenta -> violet -> indigo) at low alpha over a
    // soft pink/violet wash — the one place a grain overlay is used, so this
    // is the only status treatment with real "premium" weight to it.
    card: 'border-[#ecd5f5] border-t-[#a21caf] bg-[radial-gradient(ellipse_70%_55%_at_10%_0%,rgba(255,255,255,.4),transparent_66%),radial-gradient(ellipse_65%_60%_at_102%_104%,rgba(124,58,237,.12),transparent_70%),radial-gradient(ellipse_55%_50%_at_88%_8%,rgba(236,72,153,.1),transparent_68%),linear-gradient(135deg,#fdf2f8,#eceafe)]',
    dot: 'bg-brand',
    label: 'text-[#a21caf]',
  },
};

export interface BannerProps {
  variant: BannerVariant;
  label: string;
  role?: string;
  children: React.ReactNode;
}

export function Banner({ variant, label, role, children }: BannerProps) {
  const styles = VARIANT_STYLES[variant];

  return (
    <div
      role={role}
      className={`relative flex flex-col gap-2 overflow-hidden rounded-[14px] border border-t-2 px-[18px] py-[15px] ${styles.card}`}
    >
      {variant === 'promo' && (
        <svg
          aria-hidden="true"
          preserveAspectRatio="none"
          viewBox="0 0 200 120"
          className="pointer-events-none absolute inset-0 z-0 h-full w-full opacity-35 mix-blend-soft-light"
        >
          <filter id="bannerGrain">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} stitchTiles="stitch" />
            <feColorMatrix type="saturate" values="0" />
          </filter>
          <rect width="100%" height="100%" filter="url(#bannerGrain)" />
        </svg>
      )}
      <div className="relative z-10 flex items-center gap-2">
        <span aria-hidden="true" className={`h-[9px] w-[9px] rounded-sm ${styles.dot}`} />
        <span className={`font-mono text-[11px] uppercase tracking-[.14em] ${styles.label}`}>{label}</span>
      </div>
      <div className="relative z-10 text-sm leading-normal text-[#1f2937]">{children}</div>
    </div>
  );
}
