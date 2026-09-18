alter table public.diagnostics
  add column visual_audio_status text check (visual_audio_status in ('pending', 'complete', 'failed')),
  add column visual_audio_narrative text,
  add column visual_audio_error text;
