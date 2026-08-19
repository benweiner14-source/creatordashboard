export interface HomeCardProps {
  variant?: 'default' | 'cta';
  ariaLabelledBy?: string;
  children: React.ReactNode;
}

export function HomeCard({ variant = 'default', ariaLabelledBy, children }: HomeCardProps) {
  const base = 'flex min-h-[15.5rem] flex-col gap-4 rounded-2xl p-6';
  const defaultStyle = 'border border-gray-200 bg-white';
  const ctaStyle =
    'bg-[linear-gradient(150deg,#5b3ee0_0%,#7c3aed_55%,#a855f7_100%)] text-white shadow-[0_20px_40px_-18px_rgba(67,56,202,0.3)]';

  return (
    <article aria-labelledby={ariaLabelledBy} className={`${base} ${variant === 'cta' ? ctaStyle : defaultStyle}`}>
      {children}
    </article>
  );
}
