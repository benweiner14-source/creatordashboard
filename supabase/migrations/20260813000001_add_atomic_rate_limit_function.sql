-- Atomically checks a profile+IP rate limit window and records the event
-- in a single transaction, closing the check-then-record race a separate
-- application-level SELECT count + INSERT cannot guarantee. Generalized
-- over event_type/limits/window so future rate-limited flows (e.g.
-- magic-link requests) can reuse this function without a new one.
create or replace function public.check_and_record_rate_limit(
  p_profile_id uuid,
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
  v_profile_count integer;
  v_ip_count integer;
  v_event_id uuid;
begin
  -- Serialize concurrent calls for the same profile/IP so the count-then-insert
  -- below can never race with another call for the same key. Advisory locks
  -- are transaction-scoped and release automatically at commit/rollback.
  perform pg_advisory_xact_lock(hashtext('rate_limit_profile:' || p_profile_id::text));
  perform pg_advisory_xact_lock(hashtext('rate_limit_ip:' || p_ip_hash));

  select count(*) into v_profile_count
    from public.rate_limit_events
    where profile_id = p_profile_id
      and event_type = p_event_type
      and created_at >= p_window_start;

  if v_profile_count >= p_profile_limit then
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

  insert into public.rate_limit_events (profile_id, ip_hash, event_type, created_at)
  values (p_profile_id, p_ip_hash, p_event_type, p_now)
  returning id into v_event_id;

  return query select true, null::text, v_event_id;
end;
$$;

-- Compensating action: deletes a previously-recorded event. Used when
-- downstream work (e.g. report generation) fails after the event was
-- recorded, so a server-side failure never consumes the user's rate-limit
-- slot. Deliberately simple (no locking needed) — it only ever targets the
-- exact row id that check_and_record_rate_limit returned to its own caller.
create or replace function public.release_rate_limit_event(p_event_id uuid)
returns void
language sql
security definer set search_path = public
as $$
  delete from public.rate_limit_events where id = p_event_id;
$$;
