alter table public.diagnostics
  add column comment_analysis_status text check (comment_analysis_status in ('pending', 'complete', 'failed')),
  add column comment_analysis_narrative text,
  add column comment_analysis_has_content_request boolean,
  add column comment_analysis_content_request_summary text,
  add column comment_analysis_error text;
