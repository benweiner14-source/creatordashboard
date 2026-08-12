-- supabase/migrations/20260812000004_create_glossary_terms.sql
create table if not exists public.glossary_terms (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  term text not null,
  definition text not null,
  example text not null,
  created_at timestamptz not null default now()
);

alter table public.glossary_terms enable row level security;

create policy "Glossary terms are viewable by everyone"
  on public.glossary_terms for select
  using (true);

insert into public.glossary_terms (slug, term, definition, example) values
  ('hook-rate', 'Hook Rate', 'The percentage of people who keep watching past the first few seconds of your video. A high hook rate means your opening grabbed attention.', 'If 1,000 people started your video and 700 were still watching after 3 seconds, your hook rate is 70%.'),
  ('retention', 'Retention', 'How much of your video people actually watch, measured as a percentage of the total length. High retention tells the platform your content is worth showing to more people.', 'A 60-second video with 50% average retention means viewers watched about 30 seconds on average.'),
  ('watch-time', 'Watch Time', 'The total number of minutes people spend watching your content. Platforms use this to decide how far to distribute your video.', 'A video watched by 100 people for 2 minutes each has 200 minutes of watch time.'),
  ('engagement-rate', 'Engagement Rate', 'The share of viewers who like, comment, or share your post, compared to how many people saw it. It signals how much your content resonates.', 'A post with 10,000 views and 500 likes plus comments has a 5% engagement rate.'),
  ('format-fit', 'Format Fit', 'How well your video''s length and style match what tends to work best on the platform you posted to.', 'A 3-minute in-depth tutorial fits YouTube well, but might be too long for TikTok.'),
  ('posting-window', 'Posting Window', 'The window of time when your audience is most likely to be active and see a new post right after you publish it.', 'If most of your followers are online at 7pm, publishing at 7pm gives your post the best early boost.')
on conflict (slug) do nothing;
