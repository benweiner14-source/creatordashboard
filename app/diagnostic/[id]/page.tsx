'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { GlossaryText } from '@/components/GlossaryChip';

interface DiagnosticReportData {
  headline: string;
  scores: { overallScore: number };
  explanationSegments: Array<{ type: 'text' | 'term'; value: string }>;
  confidenceCaveat?: string | null;
}

export default function DiagnosticReportPage() {
  const params = useParams<{ id: string }>();
  const [report, setReport] = useState<DiagnosticReportData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/diagnostic/${params.id}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setError(data.error);
          return;
        }
        setReport(data.diagnostic.report_json);
      })
      .catch(() => {
        if (!cancelled) setError('Something went wrong loading your report. Please try again.');
      });
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  if (error) {
    return <p role="alert">{error}</p>;
  }

  if (!report) {
    return <p>Loading your report…</p>;
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
      <h1 className="text-2xl font-bold text-gray-900">{report.headline}</h1>
      {report.confidenceCaveat && (
        <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">{report.confidenceCaveat}</p>
      )}
      <p className="text-lg text-gray-700">Overall score: {report.scores.overallScore}</p>
      <div className="text-base leading-relaxed text-gray-800">
        <GlossaryText text={report.explanationSegments.map((s) => s.value).join('')} />
      </div>
    </main>
  );
}
