-- Generalizes rate_limit_events beyond profile-scoped events. The
-- diagnostic flow always has an authenticated profile (profile_id), but
-- pre-authentication flows like the magic-link request endpoint don't —
-- there's no profile yet, that's the whole point of the endpoint. For
-- those, the natural primary identity to rate-limit against is a salted
-- hash of the email address instead.
alter table public.rate_limit_events
  add column if not exists identity_hash text;

create index if not exists rate_limit_events_identity_hash_created_at_idx
  on public.rate_limit_events (identity_hash, created_at desc);

-- Replaces the check_and_record_rate_limit function (originally added in
-- 20260813000001_add_atomic_rate_limit_function.sql) to accept EITHER
-- p_profile_id OR p_identity_hash as the primary identity to check/count
-- against — exactly one of the two must be provided per call. The IP-based
-- secondary check and the advisory-lock-guarded atomicity are unchanged.
create or replace function public.check_and_record_rate_limit(
  p_profile_id uuid,
  p_identity_hash text,
  p_ip_hash text,
  p_event_type text,
  p_profile_limit integer,
  p_ip_limit integer,
  p_window_start timestamptz,
  p_now timestamptz
)
returns table (allowed boolean, reason text, event_id uuid)
language plpgsql
security definer set search_path = public
as $$
declare
  v_primary_count integer;
  v_ip_count integer;
  v_event_id uuid;
begin
  if p_profile_id is null and p_identity_hash is null then
    raise exception 'check_and_record_rate_limit requires either p_profile_id or p_identity_hash';
  end if;
  if p_profile_id is not null and p_identity_hash is not null then
    raise exception 'check_and_record_rate_limit accepts only one of p_profile_id or p_identity_hash';
  end if;

  -- Serialize concurrent calls for the same primary identity/IP so the
  -- count-then-insert below can never race with another call for the same
  -- key. Advisory locks are transaction-scoped and release automatically
  -- at commit/rollback.
  perform pg_advisory_xact_lock(hashtext('rate_limit_primary:' || coalesce(p_profile_id::text, p_identity_hash)));
  perform pg_advisory_xact_lock(hashtext('rate_limit_ip:' || p_ip_hash));

  if p_profile_id is not null then
    select count(*) into v_primary_count
      from public.rate_limit_events
      where profile_id = p_profile_id
        and event_type = p_event_type
        and created_at >= p_window_start;
  else
    select count(*) into v_primary_count
      from public.rate_limit_events
      where identity_hash = p_identity_hash
        and event_type = p_event_type
        and created_at >= p_window_start;
  end if;

  if v_primary_count >= p_profile_limit then
    return query select false, 'profile_limit'::text, null::uuid;
    return;
  end if;

  select count(*) into v_ip_count
    from public.rate_limit_events
    where ip_hash = p_ip_hash
      and event_type = p_event_type
      and created_at >= p_window_start;

  if v_ip_count >= p_ip_limit then
    return query select false, 'ip_limit'::text, null::uuid;
    return;
  end if;

  insert into public.rate_limit_events (profile_id, identity_hash, ip_hash, event_type, created_at)
  values (p_profile_id, p_identity_hash, p_ip_hash, p_event_type, p_now)
  returning id into v_event_id;

  return query select true, null::text, v_event_id;
end;
$$;
