-- Weekly Digest Delivery: a creator opts in to a proactive Monday email of
-- their content ideas, off by default. digest_last_sent_at exists purely to
-- keep the cron job's per-run cap fair across weeks — see
-- docs/superpowers/specs/2026-08-15-weekly-digest-delivery-design.md §1/§3.
alter table public.profiles
  add column digest_email_opt_in boolean not null default false,
  add column digest_last_sent_at timestamptz;
