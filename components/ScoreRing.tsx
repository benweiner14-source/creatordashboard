const RADIUS = 18;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export interface ScoreRingProps {
  value: number;
  label: string;
  color: string;
}

export function ScoreRing({ value, label, color }: ScoreRingProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const offset = CIRCUMFERENCE * (1 - clamped / 100);

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="48" height="48" viewBox="0 0 44 44" aria-hidden="true">
        <circle cx="22" cy="22" r={RADIUS} fill="none" stroke="#ece8f8" strokeWidth="4" />
        <circle
          data-testid="score-ring-arc"
          cx="22"
          cy="22"
          r={RADIUS}
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          transform="rotate(-90 22 22)"
        />
        <text x="22" y="26" textAnchor="middle" className="fill-gray-900 text-[9px] font-bold">
          {Math.round(clamped)}
        </text>
      </svg>
      <span className="text-[11px] text-gray-400">{label}</span>
    </div>
  );
}
