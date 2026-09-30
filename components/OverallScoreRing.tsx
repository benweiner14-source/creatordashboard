'use client';

import { useEffect, useRef, useState } from 'react';

const RADIUS = 50;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const COUNT_UP_DURATION_MS = 850;
// Safety net if rAF is throttled (e.g. a background tab) — land on the
// target value instead of visibly stalling mid-count.
const COUNT_UP_FAILSAFE_MS = COUNT_UP_DURATION_MS + 320;

export interface OverallScoreRingProps {
  value: number;
}

function bandFor(value: number): { word: string; arc: string; num: string } {
  if (value < 40) return { word: 'Building', arc: '#fb7050', num: '#c2402f' };
  if (value < 70) return { word: 'Moderate', arc: '#f97316', num: '#c2410c' };
  return { word: 'Strong', arc: '#22c55e', num: '#15803d' };
}

export function OverallScoreRing({ value }: OverallScoreRingProps) {
  const target = Math.round(Math.max(0, Math.min(100, value)));
  const [display, setDisplay] = useState(0);
  const rafRef = useRef<number | null>(null);
  const failsafeRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const reduceMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduceMotion) {
      setDisplay(target);
      return undefined;
    }

    const startTime = performance.now();
    function step(now: number) {
      const progress = Math.min(1, (now - startTime) / COUNT_UP_DURATION_MS);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(target * eased));
      if (progress < 1) rafRef.current = requestAnimationFrame(step);
    }
    rafRef.current = requestAnimationFrame(step);
    failsafeRef.current = setTimeout(() => setDisplay(target), COUNT_UP_FAILSAFE_MS);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (failsafeRef.current !== null) clearTimeout(failsafeRef.current);
    };
  }, [target]);

  const band = bandFor(display);
  const offset = CIRCUMFERENCE * (1 - display / 100);

  return (
    <div
      role="group"
      aria-label={`Overall score ${display} out of 100, band ${band.word}`}
      className="flex flex-wrap items-center gap-6"
      style={{ '--ring': 'clamp(104px, 22vw, 128px)' } as React.CSSProperties}
    >
      <div className="relative flex-none" style={{ width: 'var(--ring)', height: 'var(--ring)' }}>
        <svg width="100%" height="100%" viewBox="0 0 120 120" aria-hidden="true">
          <defs>
            <linearGradient id="overallScoreRingFrame" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#ec4899" />
              <stop offset="0.55" stopColor="#7c3aed" />
              <stop offset="1" stopColor="#4338ca" />
            </linearGradient>
          </defs>
          <circle
            cx="60"
            cy="60"
            r="57"
            fill="none"
            stroke="url(#overallScoreRingFrame)"
            strokeWidth="2"
            strokeDasharray="1.5 6"
            strokeLinecap="round"
            opacity="0.55"
          />
          <circle cx="60" cy="60" r={RADIUS} fill="none" stroke="#edeaf5" strokeWidth="10" />
          <circle
            data-testid="overall-score-ring-arc"
            cx="60"
            cy="60"
            r={RADIUS}
            fill="none"
            stroke={band.arc}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={offset}
            transform="rotate(-90 60 60)"
            style={{ transition: 'stroke-dashoffset .12s linear, stroke .3s ease' }}
          />
        </svg>
        <div
          data-testid="overall-score-number"
          className="absolute inset-0 flex items-center justify-center font-heading font-bold tabular-nums"
          style={{ fontSize: 'calc(var(--ring) * .32)', color: band.num }}
        >
          {display}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <span className="font-mono text-[11px] uppercase tracking-[.18em] text-gray-500">Overall score</span>
        <span className="font-heading text-[30px] font-bold leading-none" style={{ color: band.num }}>
          {band.word}
        </span>
        <span className="font-mono text-xs text-gray-500">{display} / 100</span>
      </div>
    </div>
  );
}
