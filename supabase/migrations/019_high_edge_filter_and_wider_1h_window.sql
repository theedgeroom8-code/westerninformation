-- 019: Client feedback (2026-10-04):
--   • 1H lines should start tracking as soon as books post them during the
--     week, not just the last ~12h before kickoff — widen period_window_hours.
--   • Alerts should only fire for HIGH edges, not every edge that clears the
--     base creation floor (min_edge_threshold). Introduces high_edge_threshold
--     as its own admin dial (was a hardcoded 4% used only for notification-
--     channel choice — now it's the actual send/don't-send gate for both
--     push and the SMS outbox).
--   • The Games board should only list games that currently have a high
--     edge, not every scheduled game — admin can read the live threshold
--     via board_games()'s meta instead of the UI hardcoding its own number.
--     (Note: this does NOT reduce API credit usage — the engine still has to
--     scan every game to know which ones qualify. See the report.)
--
-- edges with edge_pct between min_edge_threshold and high_edge_threshold are
-- still created and still show up in track-record / admin views — they just
-- no longer alert or appear on the player's Games board.

-- ============================================================
-- CONFIG
-- ============================================================
insert into public.app_config (key, value)
values ('high_edge_threshold', '5.0'::jsonb)
on conflict (key) do nothing;

update public.app_config set value = '168'::jsonb, updated_at = now()
  where key = 'period_window_hours';

-- ============================================================
-- PUSH — only alert on edges at/above the high-edge threshold
-- ============================================================
create or replace function public.push_notify_edge()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_messages jsonb;
  v_high_threshold numeric := coalesce((public.engine_cfg('high_edge_threshold') #>> '{}')::numeric, 5.0);
begin
  if not public.edge_alerts_enabled() then return new; end if;
  if new.edge_pct < v_high_threshold then return new; end if;

  select jsonb_agg(jsonb_build_object(
    'to', pt.token,
    'title', '⚡ ' || to_char(new.edge_pct, 'FM990.0') || '% Edge — ' || new.sport,
    'body', public.engine_edge_alert_text(new, coalesce(b.balance, 0), s.kelly_fraction),
    'data', jsonb_build_object('type', 'edge', 'edgeId', new.id),
    'sound', 'default',
    'priority', 'high',
    'channelId', case when s.high_edge_alerts then 'high-edge' else 'edges' end
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

-- ============================================================
-- SMS OUTBOX — same gate
-- ============================================================
create or replace function public.queue_sms_edge()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_high_threshold numeric := coalesce((public.engine_cfg('high_edge_threshold') #>> '{}')::numeric, 5.0);
begin
  if not public.edge_alerts_enabled() then return new; end if;
  if new.edge_pct < v_high_threshold then return new; end if;

  insert into public.sms_outbox (user_id, phone, body, edge_id)
  select s.user_id, p.phone,
         public.engine_edge_alert_text(new, coalesce(b.balance, 0), s.kelly_fraction),
         new.id
  from public.user_settings s
  join public.profiles p on p.id = s.user_id and p.is_active
  left join public.bankrolls b on b.user_id = s.user_id
  where s.sms_alerts
    and p.phone is not null and length(trim(p.phone)) > 0
    and not public.in_quiet_hours(s);
  return new;
end;
$$;

-- ============================================================
-- BOARD — expose the live threshold so the client filters against the real
-- admin-tunable number instead of hardcoding a duplicate of its own
-- ============================================================
create or replace function public.board_games(p_sport text, p_period text default 'FG')
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_books text[]; v_prio text[]; v_fg int; v_per int; v_stale int; v_high numeric;
  v_games jsonb; v_upd timestamptz;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if p_period not in ('FG','1H','2H','1Q','2Q','3Q','4Q') then raise exception 'Unknown period'; end if;

  v_fg := public.engine_cfg_int('poll_interval_minutes', 15);
  v_per := public.engine_cfg_int('period_refresh_minutes', 120);
  v_stale := 2 * case when p_period = 'FG' then v_fg else v_per end;
  v_high := coalesce((public.engine_cfg('high_edge_threshold') #>> '{}')::numeric, 5.0);

  if not (p_sport = any(public.engine_cfg_list('board_sports'))) then
    return jsonb_build_object('games', '[]'::jsonb, 'meta', jsonb_build_object(
      'enabled', false, 'staleMin', v_stale,
      'periodEnabled', false, 'periodWindowHours', public.engine_cfg_int('period_window_hours', 30),
      'highEdgeThreshold', v_high));
  end if;

  v_prio := public.engine_cfg_list('board_book_priority');
  select coalesce(array_agg(b order by coalesce(array_position(v_prio, b), 999), b), '{}')
    into v_books
    from (select x as b from unnest(public.engine_cfg_list('active_books')) x
          where x in (select display_name from public.api_book_map)) s;

  with g as (
    select gm.*,
           case when gm.completed then 'final'
                when gm.commence_time > now() then 'upcoming'
                when gm.commence_time < now() - interval '5 hours' then 'final'
                else 'live' end as st
    from public.games gm
    where gm.sport = p_sport and not gm.completed
      and gm.commence_time > now() - interval '5 hours'
      and gm.commence_time < now() + interval '8 days'
  ), pick as (
    -- one book per market: highest-priority book that has it (3-way ML wins over 2-way within that book)
    select distinct on (gl.game_id, case gl.market when 'h2h3' then 'h2h' else gl.market end)
           gl.game_id,
           case gl.market when 'h2h3' then 'h2h' else gl.market end as grp,
           gl.market, gl.book, gl.outcomes, gl.book_updated_at, gl.fetched_at
    from public.game_lines gl
    join g on g.id = gl.game_id
    where gl.period = p_period and gl.book = any(v_books)
    order by gl.game_id, case gl.market when 'h2h3' then 'h2h' else gl.market end,
             array_position(v_books, gl.book), (gl.market = 'h2h3') desc
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', g.id, 'home', g.home_team, 'away', g.away_team,
           'commence', g.commence_time, 'status', g.st,
           'homeScore', g.home_score, 'awayScore', g.away_score,
           'markets', coalesce((
             select jsonb_object_agg(p.grp, jsonb_build_object(
                      'book', p.book, 'market', p.market, 'outcomes', p.outcomes,
                      'updatedAt', p.book_updated_at,
                      'stale', least(p.book_updated_at, p.fetched_at) < now() - make_interval(mins => v_stale)))
             from pick p where p.game_id = g.id), '{}'::jsonb)
         ) order by g.commence_time, g.id), '[]'::jsonb)
    into v_games
    from g;

  select max(gl.fetched_at) into v_upd
    from public.game_lines gl join public.games gm on gm.id = gl.game_id
    where gm.sport = p_sport and gl.period = p_period;

  return jsonb_build_object(
    'games', v_games,
    'meta', jsonb_build_object(
      'enabled', true,
      'updatedAt', v_upd,
      'staleMin', v_stale,
      'fgRefreshMin', v_fg,
      'periodRefreshMin', v_per,
      'periodEnabled', coalesce((public.engine_cfg('period_lines_enabled') #>> '{}')::boolean, false),
      'periodWindowHours', public.engine_cfg_int('period_window_hours', 30),
      'highEdgeThreshold', v_high
    ));
end;
$$;
