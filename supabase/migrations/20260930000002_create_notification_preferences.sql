create table public.notification_preferences (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  weekly_recap_ready boolean not null default true,
  new_content_ideas_ready boolean not null default true,
  diagnostic_finished boolean not null default true,
  product_marketing boolean not null default false,
  payment_billing_alerts boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.notification_preferences enable row level security;

create policy "Notification preferences are viewable by owner"
  on public.notification_preferences for select
  using ((select auth.uid()) = profile_id);

-- No client-facing insert/update policy: writes happen through
-- PATCH /api/settings/notifications via the service-role client only.

-- Backfill: every existing profile's weekly-digest opt-in maps to the
-- closest new toggle, so nobody's existing subscription silently resets.
insert into public.notification_preferences (profile_id, new_content_ideas_ready)
select id, digest_email_opt_in from public.profiles
on conflict (profile_id) do nothing;

-- Every new signup also gets a default preferences row going forward,
-- alongside its profiles row. Redefines the existing trigger function
-- rather than adding a second trigger, so both inserts stay one
-- transaction under the same on_auth_user_created trigger.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  insert into public.notification_preferences (profile_id)
  values (new.id);
  return new;
end;
$$;
