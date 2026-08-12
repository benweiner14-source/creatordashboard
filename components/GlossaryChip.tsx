'use client';

import { useState } from 'react';
import { linkGlossaryTerms, type GlossaryTerm } from '@/lib/glossary';

export interface GlossaryChipProps {
  term: GlossaryTerm;
  children: React.ReactNode;
}

export function GlossaryChip({ term, children }: GlossaryChipProps) {
  const [open, setOpen] = useState(false);

  return (
    <span className="relative inline-block">
      <button
        type="button"
        className="underline decoration-dotted decoration-2 underline-offset-2 text-indigo-700 hover:text-indigo-900"
        aria-expanded={open}
        aria-describedby={`glossary-${term.slug}`}
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        {children}
      </button>
      {open && (
        <span
          id={`glossary-${term.slug}`}
          role="tooltip"
          className="absolute z-10 mt-2 w-64 rounded-lg border border-gray-200 bg-white p-3 text-sm shadow-lg"
        >
          <span className="block font-semibold text-gray-900">{term.term}</span>
          <span className="mt-1 block text-gray-700">{term.definition}</span>
          <span className="mt-1 block italic text-gray-500">{term.example}</span>
        </span>
      )}
    </span>
  );
}

export interface GlossaryTextProps {
  text: string;
}

export function GlossaryText({ text }: GlossaryTextProps) {
  const segments = linkGlossaryTerms(text);
  return (
    <>
      {segments.map((segment, i) =>
        segment.type === 'term' ? (
          <GlossaryChip key={i} term={segment.term}>
            {segment.value}
          </GlossaryChip>
        ) : (
          <span key={i}>{segment.value}</span>
        )
      )}
    </>
  );
}
