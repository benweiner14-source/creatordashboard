export interface GlossaryTerm {
  slug: string;
  term: string;
  definition: string;
  example: string;
}

export const GLOSSARY_TERMS: GlossaryTerm[] = [
  { slug: 'hook-rate', term: 'Hook Rate', definition: 'The percentage of people who keep watching past the first few seconds of your video. A high hook rate means your opening grabbed attention.', example: 'If 1,000 people started your video and 700 were still watching after 3 seconds, your hook rate is 70%.' },
  { slug: 'retention', term: 'Retention', definition: 'How much of your video people actually watch, measured as a percentage of the total length. High retention tells the platform your content is worth showing to more people.', example: 'A 60-second video with 50% average retention means viewers watched about 30 seconds on average.' },
  { slug: 'watch-time', term: 'Watch Time', definition: 'The total number of minutes people spend watching your content. Platforms use this to decide how far to distribute your video.', example: 'A video watched by 100 people for 2 minutes each has 200 minutes of watch time.' },
  { slug: 'engagement-rate', term: 'Engagement Rate', definition: 'The share of viewers who like, comment, or share your post, compared to how many people saw it. It signals how much your content resonates.', example: 'A post with 10,000 views and 500 likes plus comments has a 5% engagement rate.' },
  { slug: 'format-fit', term: 'Format Fit', definition: "How well your video's length and style match what tends to work best on the platform you posted to.", example: 'A 3-minute in-depth tutorial fits YouTube well, but might be too long for TikTok.' },
  { slug: 'posting-window', term: 'Posting Window', definition: 'The window of time when your audience is most likely to be active and see a new post right after you publish it.', example: 'If most of your followers are online at 7pm, publishing at 7pm gives your post the best early boost.' },
  {
    slug: 'content-pillars',
    term: 'Content Pillars',
    definition: 'The 2-4 main topics you consistently post about, so people know what to expect from you and start seeing you as the person to follow for that subject.',
    example: "If your content pillars are 'career advice' and 'behind-the-scenes of the industry,' every post should fit one of those two buckets.",
  },
  {
    slug: 'posting-cadence',
    term: 'Posting Cadence',
    definition: 'How often you post, on average — the rhythm your audience can expect and rely on.',
    example: 'A posting cadence of 2x/week means people can expect roughly two new posts every week, not a burst of five posts one week and none the next.',
  },
  {
    slug: 'positioning',
    term: 'Positioning',
    definition: "How you present yourself so the right people immediately understand what you're about and why they should pay attention to you.",
    example: "Someone with strong positioning as a 'gaming industry analyst' gets noticed by gaming companies faster than someone whose profile doesn't say what they're known for.",
  },
];

export function getGlossaryTerms(): GlossaryTerm[] {
  return GLOSSARY_TERMS;
}

export function findGlossaryTermBySlug(slug: string): GlossaryTerm | undefined {
  return GLOSSARY_TERMS.find((t) => t.slug === slug);
}

export type GlossarySegment =
  | { type: 'text'; value: string }
  | { type: 'term'; value: string; term: GlossaryTerm };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function linkGlossaryTerms(text: string, terms: GlossaryTerm[] = GLOSSARY_TERMS): GlossarySegment[] {
  if (!text) return [];
  const sorted = [...terms].sort((a, b) => b.term.length - a.term.length);
  const pattern = sorted.map((t) => escapeRegExp(t.term)).join('|');
  if (!pattern) return [{ type: 'text', value: text }];

  const regex = new RegExp(`\\b(${pattern})\\b`, 'gi');
  const segments: GlossarySegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    const matchedTerm = terms.find((t) => t.term.toLowerCase() === match![0].toLowerCase())!;
    segments.push({ type: 'term', value: match[0], term: matchedTerm });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) });
  }
  return segments;
}
