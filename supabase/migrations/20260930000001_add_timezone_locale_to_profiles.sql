alter table public.profiles
  add column timezone text not null default 'UTC',
  add column locale text not null default 'en-US';
