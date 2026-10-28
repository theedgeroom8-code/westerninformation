-- ============================================================
-- NHL — client (2026-10-28): "Hockey game Moneyline and total" —
-- full game only, no 1H. The base poll (engine_maybe_poll) already fetches
-- h2h/spreads/totals generically for every active/board sport, so NHL needs
-- no change there. The ONLY change needed is to keep hockey games out of the
-- 1H period-poll loop, which otherwise would blindly request spreads_h1/
-- totals_h1/h2h_h1 for every board_sport — markets that don't apply to a
-- 3-period game and would just waste credits on empty responses.
-- ============================================================
create or replace function public.engine_maybe_poll_periods()
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_interval int := public.engine_cfg_int('period_refresh_minutes', 120);
  v_window int := public.engine_cfg_int('period_window_hours', 30);
  v_cap int := public.engine_cfg_int('period_daily_credit_cap', 800);
  v_reserve int := public.engine_cfg_int('credit_reserve', 500);
  v_batch int := 4;
  v_state public.engine_state%rowtype;
  v_key text; v_books text; v_markets text; v_url text; v_req bigint;
  v_day date := (now() at time zone 'America/New_York')::date;
  v_spent int; v_inflight int; v_recent int; v_hourly int; v_budget int; v_g record; v_fired int := 0;
begin
  if not coalesce((public.engine_cfg('engine_enabled') #>> '{}')::boolean, false) then return; end if;
  if not coalesce((public.engine_cfg('period_lines_enabled') #>> '{}')::boolean, false) then return; end if;

  select * into v_state from public.engine_state where id = 1;
  if v_state.credits_remaining is null or v_state.credits_remaining <= v_reserve then return; end if;

  v_cap := least(v_cap, floor((v_state.credits_remaining - v_reserve) * 0.10)::int);
  select coalesce(sum(credits), 0) into v_spent from public.engine_period_spend where day = v_day;
  select count(*) into v_inflight from public.engine_requests where req_type = 'period' and not processed;
  -- games fetched in the last hour (in-flight ones are already stamped), at their learned cost
  select coalesce(sum(coalesce(period_cost, 4)), 0) into v_recent
    from public.games where period_polled_at > now() - interval '60 minutes';
  v_hourly := greatest(ceil(v_cap / 4.0)::int, 50);
  v_budget := least(v_cap - v_spent - v_inflight * 4, v_hourly - v_recent);
  if v_budget < 2 then return; end if;

  select value into v_key from private.secrets where name = 'odds_api_key';
  if v_key is null then return; end if;

  select string_agg(distinct k, ',') into v_books
  from (
    select m.api_key as k from public.api_book_map m
    where m.display_name = any(public.engine_cfg_list('active_books'))
    union select 'pinnacle'
  ) t;

  -- 1H only (client: "just game and 1H") — h2h3 kept for the 3-way tie price
  select string_agg(public.engine_api_market(b, p), ',') into v_markets
  from unnest(array['h2h','h2h3','spreads','totals']) b,
       unnest(array['1H']) p;

  for v_g in
    select g.id, g.api_sport, g.sport, coalesce(g.period_cost, 4) as est
    from public.games g
    where g.sport = any(public.engine_cfg_list('board_sports'))
      and g.sport <> 'NHL'  -- client wants hockey at game level only, no 1H
      and g.commence_time > now() + interval '10 minutes'
      and g.commence_time <= now() + make_interval(hours => v_window)
      and (g.period_polled_at is null
           or g.period_polled_at <= now() - make_interval(
                mins => case when g.period_cost = 0 then greatest(v_interval * 3, 360) else v_interval end))
      and not exists (select 1 from public.engine_requests r
                      where r.req_type = 'period' and r.event_id = g.id and not r.processed)
    order by g.commence_time, g.id
    limit v_batch
  loop
    exit when v_budget < v_g.est;
    v_url := 'https://api.the-odds-api.com/v4/sports/' || v_g.api_sport || '/events/' || v_g.id
          || '/odds?apiKey=' || v_key
          || '&bookmakers=' || v_books
          || '&markets=' || v_markets
          || '&oddsFormat=american';
    v_req := net.http_get(url := v_url, timeout_milliseconds := 20000);
    insert into public.engine_requests (request_id, sport, api_sport, req_type, event_id)
    values (v_req, v_g.sport, v_g.api_sport, 'period', v_g.id);
    update public.games set period_polled_at = now() where id = v_g.id;
    v_budget := v_budget - v_g.est;
    v_fired := v_fired + 1;
  end loop;
end;
$$;
