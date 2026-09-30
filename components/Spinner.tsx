export interface SpinnerProps {
  label: string;
  /**
   * 'onDark' (default) is white-on-white/40, for use inside a solid-color
   * button. 'onLight' is a dark accent ring on a light track, for spinners
   * that sit directly on the page background — see e.g. Ideas/Recap's
   * "Still working…" states.
   */
  variant?: 'onDark' | 'onLight';
}

export function Spinner({ label, variant = 'onDark' }: SpinnerProps) {
  const ringClass =
    variant === 'onLight'
      ? 'border-[#e5e7eb] border-t-[#7c3aed]'
      : 'border-white/40 border-t-white';

  return (
    <span className="inline-flex items-center gap-2" role="status">
      <span aria-hidden="true" className={`h-4 w-4 animate-spin rounded-full border-2 ${ringClass}`} />
      <span>{label}</span>
    </span>
  );
}
