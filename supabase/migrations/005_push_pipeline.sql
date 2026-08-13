-- 005: Push notification delivery pipeline + broadcast read-tracking.
--
-- Delivery model: Postgres triggers batch-post to Expo's Push API via pg_net
-- (async, non-blocking). Expo routes to FCM (Android) / APNs (iOS).
-- Devices register tokens into push_tokens from the app (dev build required —
-- Expo Go cannot receive remote push).

create extension if not exists pg_net;

-- ---------- broadcast read-tracking (bell badge) ----------
alter table public.user_settings
  add column if not exists seen_broadcasts_at timestamptz not null default now();

-- ---------- helper: is user inside quiet hours (UTC-based for now) ----------
create or replace function public.in_quiet_hours(s public.user_settings)
returns boolean
language sql immutable
as $$
  select case
    when not s.quiet_hours_enabled then false
    when s.quiet_start = s.quiet_end then false
    when s.quiet_start < s.quiet_end
      then extract(hour from now() at time zone 'utc') >= s.quiet_start
       and extract(hour from now() at time zone 'utc') < s.quiet_end
    else extract(hour from now() at time zone 'utc') >= s.quiet_start
      or extract(hour from now() at time zone 'utc') < s.quiet_end
  end;
$$;

-- ---------- helper: send a batch of Expo push messages (chunks of 100) ----------
create or replace function public.send_expo_push(p_messages jsonb)
returns void
language plpgsql
as $$
declare
  v_total int := jsonb_array_length(p_messages);
  v_offset int := 0;
  v_chunk jsonb;
begin
  while v_offset < v_total loop
    select jsonb_agg(value) into v_chunk
    from jsonb_array_elements(p_messages) with ordinality t(value, idx)
    where idx > v_offset and idx <= v_offset + 100;

    perform net.http_post(
      url := 'https://exp.host/--/api/v2/push/send',
      headers := '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb,
      body := v_chunk
    );
    v_offset := v_offset + 100;
  end loop;
end;
$$;

-- ---------- edge published → personalized push to opted-in users ----------
create or replace function public.push_notify_edge()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_messages jsonb;
  v_is_high boolean := new.edge_pct >= 4;
  v_dec numeric := case when new.local_odds > 0
                        then 1 + new.local_odds / 100.0
                        else 1 + 100.0 / abs(new.local_odds) end;
begin
  select jsonb_agg(jsonb_build_object(
    'to', pt.token,
    'title', '⚡ ' || to_char(new.edge_pct, 'FM990.0') || '% Edge — ' || new.sport,
    'body', new.matchup || E'\n' || new.specific_bet || ' @ ' || new.local_book
            || ' (' || (case when new.local_odds > 0 then '+' else '' end) || new.local_odds || ')'
            || ' · Bet $' || greatest(0, round(
                 coalesce(b.balance, 0) * (new.edge_pct / 100.0) * v_dec / (v_dec - 1)
                 * (s.kelly_fraction / 100.0)))::text,
    'data', jsonb_build_object('type', 'edge', 'edgeId', new.id),
    'sound', 'default',
    'priority', 'high',
    'channelId', case when v_is_high and s.high_edge_alerts then 'high-edge' else 'edges' end
  ))
  into v_messages
  from public.push_tokens pt
  join public.profiles p on p.id = pt.user_id and p.is_active
  join public.user_settings s on s.user_id = pt.user_id
  left join public.bankrolls b on b.user_id = pt.user_id
  where s.push_alerts
    and not public.in_quiet_hours(s);

  if v_messages is not null then
    perform public.send_expo_push(v_messages);
  end if;
  return new;
end;
$$;
drop trigger if exists push_notify_edge on public.edges;
create trigger push_notify_edge
  after insert on public.edges
  for each row execute function public.push_notify_edge();

-- ---------- broadcast → push to opted-in users ----------
create or replace function public.push_notify_broadcast()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare v_messages jsonb;
begin
  select jsonb_agg(jsonb_build_object(
    'to', pt.token,
    'title', '📣 ' || new.title,
    'body', new.message,
    'data', jsonb_build_object('type', 'broadcast'),
    'sound', 'default',
    'channelId', 'announcements'
  ))
  into v_messages
  from public.push_tokens pt
  join public.profiles p on p.id = pt.user_id and p.is_active
  join public.user_settings s on s.user_id = pt.user_id
  where s.push_alerts
    and not public.in_quiet_hours(s);

  if v_messages is not null then
    perform public.send_expo_push(v_messages);
  end if;
  return new;
end;
$$;
drop trigger if exists push_notify_broadcast on public.broadcasts;
create trigger push_notify_broadcast
  after insert on public.broadcasts
  for each row execute function public.push_notify_broadcast();
