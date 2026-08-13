-- 007: REAL-TIME ODDS ENGINE
--
-- Runs entirely inside Postgres — no external server needed:
--   pg_cron (every minute) → engine_tick()
--     1. expire edges whose game has started
--     2. process any API responses that arrived (async via pg_net)
--     3. if the poll interval elapsed: fire new Odds API requests
--
-- Detection pipeline per response:
--   Pinnacle (sharp) two-sided prices → strip vig → fair win probability
--   → compare every monitored local book's price at the SAME line
--   → edge% = (fair_prob × decimal_odds − 1) × 100
--   → apply admin dials: min_edge_threshold, pre_game_cutoff_minutes,
--     duplicate_suppression, active_books, active_sports
--   → insert into edges (+ edge_method for admins) — the existing fan-out
--     and push triggers alert every user automatically.
--
-- API-cost controls:
--   • regions computed from active books (eu always — Pinnacle lives there)
--   • out-of-season sports (0 events) re-polled at most every 6 hours
--   • hard credit reserve: engine pauses itself before the quota is gone
--   • poll interval admin-configurable (default 60 min)

create extension if not exists pg_cron;

-- ============================================================
-- SECRETS — private schema, invisible to the API roles
-- ============================================================
create schema if not exists private;
create table if not exists private.secrets (
  name text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
revoke all on schema private from public, anon, authenticated;
revoke all on private.secrets from public, anon, authenticated;

-- ============================================================
-- MAPPINGS — app names ↔ The Odds API keys
-- ============================================================
create table if not exists public.api_sport_map (
  sport text primary key,
  api_key text not null
);
insert into public.api_sport_map (sport, api_key) values
  ('NFL',   'americanfootball_nfl'),
  ('NCAAF', 'americanfootball_ncaaf'),
  ('NBA',   'basketball_nba'),
  ('NCAAB', 'basketball_ncaab'),
  ('MLB',   'baseball_mlb'),
  ('NHL',   'icehockey_nhl')
on conflict do nothing;  -- targetless: table shape changes in 008 (api_key pk)

-- Books carried by The Odds API. Books NOT listed here (South Point,
-- Treasure Island, Coast Casino) can only receive manual edges.
create table if not exists public.api_book_map (
  display_name text primary key,
  api_key text not null,
  region text not null default 'us'
);
insert into public.api_book_map (display_name, api_key, region) values
  ('DraftKings', 'draftkings',     'us'),
  ('BetMGM',     'betmgm',         'us'),
  ('Caesars',    'williamhill_us', 'us'),
  ('Wynn',       'wynnbet',        'us'),
  ('Circa',      'circasports',    'us2')
on conflict (display_name) do nothing;

-- ============================================================
-- ENGINE STATE + LOG (admin-only visibility, realtime)
-- ============================================================
create table if not exists public.engine_state (
  id int primary key default 1 check (id = 1),
  last_poll_at timestamptz,
  credits_remaining int,
  last_status text not null default 'idle',
  paused_reason text,
  updated_at timestamptz not null default now()
);
insert into public.engine_state (id) values (1) on conflict (id) do nothing;

create table if not exists public.engine_requests (
  request_id bigint primary key,
  sport text not null,
  api_sport text not null,
  fired_at timestamptz not null default now(),
  processed boolean not null default false
);

create table if not exists public.engine_sport_state (
  sport text primary key,
  last_polled_at timestamptz,
  last_events int
);

create table if not exists public.engine_runs (
  id bigserial primary key,
  at timestamptz not null default now(),
  kind text not null,          -- poll | scan | expire | pause | error
  sport text,
  events int,
  edges_created int,
  credits_remaining int,
  detail text
);
create index if not exists engine_runs_at_idx on public.engine_runs (at desc);

alter table public.engine_state enable row level security;
alter table public.engine_requests enable row level security;
alter table public.engine_sport_state enable row level security;
alter table public.engine_runs enable row level security;
alter table public.api_sport_map enable row level security;
alter table public.api_book_map enable row level security;

drop policy if exists "engine_state_admin" on public.engine_state;
create policy "engine_state_admin" on public.engine_state for select using (public.is_admin());
drop policy if exists "engine_requests_admin" on public.engine_requests;
create policy "engine_requests_admin" on public.engine_requests for select using (public.is_admin());
drop policy if exists "engine_sport_state_admin" on public.engine_sport_state;
create policy "engine_sport_state_admin" on public.engine_sport_state for select using (public.is_admin());
drop policy if exists "engine_runs_admin" on public.engine_runs;
create policy "engine_runs_admin" on public.engine_runs for select using (public.is_admin());
drop policy if exists "api_sport_map_admin" on public.api_sport_map;
create policy "api_sport_map_admin" on public.api_sport_map for select using (public.is_admin());
drop policy if exists "api_book_map_admin" on public.api_book_map;
create policy "api_book_map_admin" on public.api_book_map for select using (public.is_admin());

do $$
begin
  begin alter publication supabase_realtime add table public.engine_state; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.engine_runs; exception when duplicate_object then null; end;
end $$;

-- ============================================================
-- CONFIG SEEDS
-- ============================================================
insert into public.app_config (key, value) values
  ('engine_enabled', 'false'::jsonb),
  ('poll_interval_minutes', '60'::jsonb),
  ('credit_reserve', '500'::jsonb),
  ('max_edges_per_scan', '8'::jsonb)
on conflict (key) do nothing;

-- ============================================================
-- PURE HELPERS
-- ============================================================
create or replace function public.engine_cfg(p_key text)
returns jsonb
language sql stable
set search_path = public
as $$ select value from public.app_config where key = p_key $$;

-- American price → implied probability (with the vig still in it)
create or replace function public.engine_implied(p_price numeric)
returns numeric
language sql immutable
as $$
  select case
    when p_price is null or p_price = 0 then null
    when p_price > 0 then 100 / (p_price + 100)
    else abs(p_price) / (abs(p_price) + 100)
  end
$$;

-- Probability → fair American odds
create or replace function public.engine_prob_to_american(p numeric)
returns int
language sql immutable
as $$
  select case
    when p is null or p <= 0 or p >= 1 then null
    when p >= 0.5 then -round((p / (1 - p)) * 100)::int
    else round(((1 - p) / p) * 100)::int
  end
$$;

-- 209.50 → '209.5', 6.0 → '6'
create or replace function public.engine_fmt_point(p numeric)
returns text
language sql immutable
as $$
  select case when p is null then null
              when p = trunc(p) then trunc(p)::text
              else rtrim(p::text, '0') end
$$;

-- Find a market object ({key, outcomes:[...]}) inside a bookmaker object
create or replace function public.engine_find_market(p_bookmaker jsonb, p_key text)
returns jsonb
language sql immutable
as $$
  select m.value from jsonb_array_elements(coalesce(p_bookmaker->'markets', '[]'::jsonb)) m
  where m.value->>'key' = p_key limit 1
$$;

-- Find an outcome by name + exact point (both-null counts as a match)
create or replace function public.engine_find_outcome(p_market jsonb, p_name text, p_point numeric)
returns jsonb
language sql immutable
as $$
  select o.value from jsonb_array_elements(coalesce(p_market->'outcomes', '[]'::jsonb)) o
  where o.value->>'name' = p_name
    and (o.value->>'point')::numeric is not distinct from p_point
  limit 1
$$;

-- No-vig fair probability for one outcome of a TWO-WAY sharp market.
-- Returns null when the outcome/point doesn't match (line moved) or data is bad.
create or replace function public.engine_outcome_fair(p_market jsonb, p_name text, p_point numeric)
returns numeric
language plpgsql immutable
as $$
declare
  o1 jsonb; o2 jsonb; p1 numeric; p2 numeric; total numeric;
begin
  if p_market is null or jsonb_array_length(coalesce(p_market->'outcomes', '[]'::jsonb)) <> 2 then
    return null;
  end if;
  o1 := p_market->'outcomes'->0;
  o2 := p_market->'outcomes'->1;
  p1 := public.engine_implied((o1->>'price')::numeric);
  p2 := public.engine_implied((o2->>'price')::numeric);
  if p1 is null or p2 is null then return null; end if;
  total := p1 + p2;
  if total <= 1 then return null; end if;  -- no vig at all → suspicious data
  if o1->>'name' = p_name and (o1->>'point')::numeric is not distinct from p_point then
    return p1 / total;
  elsif o2->>'name' = p_name and (o2->>'point')::numeric is not distinct from p_point then
    return p2 / total;
  end if;
  return null;
end;
$$;

-- ============================================================
-- STEP 1 — expire edges whose game has started
-- ============================================================
create or replace function public.engine_expire_stale()
returns void
language plpgsql security definer
set search_path = public
as $$
declare v_n int;
begin
  with upd as (
    update public.edges set status = 'expired'
    where status = 'active' and game_time <= now()
    returning 1
  )
  select count(*) into v_n from upd;
  if v_n > 0 then
    insert into public.engine_runs (kind, detail)
    values ('expire', v_n || ' edge(s) expired at game start');
  end if;
end;
$$;

-- ============================================================
-- STEP 2b — scan one sport's events for edges
-- ============================================================
create or replace function public.engine_scan_events(p_sport text, p_events jsonb)
returns int
language plpgsql security definer
set search_path = public
as $$
declare
  v_threshold numeric := coalesce((public.engine_cfg('min_edge_threshold') #>> '{}')::numeric, 2.0);
  v_cutoff int := coalesce((public.engine_cfg('pre_game_cutoff_minutes') #>> '{}')::int, 30);
  v_dup boolean := coalesce((public.engine_cfg('duplicate_suppression') #>> '{}')::boolean, true);
  v_max int := coalesce((public.engine_cfg('max_edges_per_scan') #>> '{}')::int, 8);
  v_active_books text[];
  v_cands jsonb := '[]'::jsonb;
  v_created int := 0;
  v_expired int := 0;
  v_ev jsonb; v_pinn jsonb; v_pm jsonb; v_lm jsonb; v_lo jsonb; v_pinn_o jsonb;
  v_ex public.edges%rowtype;
  v_rec record;
  v_event_id text; v_matchup text; v_home text; v_away text;
  v_commence timestamptz;
  v_mkey text; v_name text; v_point numeric; v_price numeric;
  v_fair numeric; v_dec numeric; v_edge numeric;
  v_bk jsonb; v_c jsonb; v_eid uuid; v_bt text; v_sb text;
begin
  select coalesce(array_agg(x), '{}') into v_active_books
  from jsonb_array_elements_text(coalesce(public.engine_cfg('active_books'), '[]'::jsonb)) t(x);

  for v_ev in select value from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) loop
    v_event_id := v_ev->>'id';
    v_commence := (v_ev->>'commence_time')::timestamptz;
    v_home := v_ev->>'home_team';
    v_away := v_ev->>'away_team';
    if v_event_id is null or v_commence is null or v_home is null then continue; end if;
    v_matchup := left(v_away || ' @ ' || v_home, 120);

    v_pinn := (select b.value from jsonb_array_elements(coalesce(v_ev->'bookmakers','[]'::jsonb)) b
               where b.value->>'key' = 'pinnacle' limit 1);

    -- ---- (A) verify EXISTING engine edges for this event: refresh or expire ----
    if v_pinn is not null then
      for v_ex in select * from public.edges
                  where event_id = v_event_id and source = 'engine' and status = 'active' loop
        v_pm := public.engine_find_market(v_pinn, v_ex.market_key);
        v_fair := public.engine_outcome_fair(v_pm, v_ex.outcome_name, v_ex.point);
        select b.value into v_bk
          from jsonb_array_elements(coalesce(v_ev->'bookmakers','[]'::jsonb)) b
          join public.api_book_map m on m.api_key = b.value->>'key'
          where m.display_name = v_ex.local_book limit 1;
        v_lo := public.engine_find_outcome(
                  public.engine_find_market(v_bk, v_ex.market_key), v_ex.outcome_name, v_ex.point);
        if v_fair is null or v_lo is null then
          -- line moved or was pulled — we can no longer verify the edge
          update public.edges set status = 'expired' where id = v_ex.id;
          v_expired := v_expired + 1;
        else
          v_price := (v_lo->>'price')::numeric;
          v_dec := case when v_price > 0 then 1 + v_price/100 else 1 + 100/abs(v_price) end;
          v_edge := (v_fair * v_dec - 1) * 100;
          if v_edge < greatest(v_threshold * 0.5, 0.5) then
            update public.edges set status = 'expired' where id = v_ex.id;
            v_expired := v_expired + 1;
          elsif round(v_price)::int <> v_ex.local_odds or round(v_edge, 2) <> v_ex.edge_pct then
            -- silent refresh: UPDATE fires no alert triggers, feed stays accurate
            update public.edges
              set local_odds = round(v_price)::int, edge_pct = round(v_edge, 2)
              where id = v_ex.id;
          end if;
        end if;
      end loop;
    end if;

    -- ---- (B) hunt for NEW edges ----
    if v_pinn is null then continue; end if;
    if v_commence <= now() + make_interval(mins => v_cutoff) then continue; end if;

    foreach v_mkey in array array['h2h','spreads','totals'] loop
      v_pm := public.engine_find_market(v_pinn, v_mkey);
      if v_pm is null or jsonb_array_length(coalesce(v_pm->'outcomes','[]'::jsonb)) <> 2 then continue; end if;

      for v_rec in
        select b.value as book, m.display_name
        from jsonb_array_elements(coalesce(v_ev->'bookmakers','[]'::jsonb)) b
        join public.api_book_map m on m.api_key = b.value->>'key'
        where m.display_name = any(v_active_books)
      loop
        v_lm := public.engine_find_market(v_rec.book, v_mkey);
        if v_lm is null then continue; end if;

        for v_lo in select value from jsonb_array_elements(coalesce(v_lm->'outcomes','[]'::jsonb)) loop
          v_name := v_lo->>'name';
          v_point := (v_lo->>'point')::numeric;
          v_price := (v_lo->>'price')::numeric;
          if v_name is null or v_price is null then continue; end if;
          if abs(v_price) < 100 or abs(v_price) > 100000 then continue; end if;

          v_fair := public.engine_outcome_fair(v_pm, v_name, v_point);
          if v_fair is null then continue; end if;  -- different line than sharp — not comparable

          v_dec := case when v_price > 0 then 1 + v_price/100 else 1 + 100/abs(v_price) end;
          v_edge := (v_fair * v_dec - 1) * 100;
          if v_edge < v_threshold then continue; end if;
          if v_edge > 20 then continue; end if;  -- stale/erroneous feed guard

          -- exact duplicate already live?
          if exists (select 1 from public.edges
                     where event_id = v_event_id and market_key = v_mkey
                       and outcome_name = v_name and point is not distinct from v_point
                       and local_book = v_rec.display_name and status = 'active') then
            continue;
          end if;
          -- admin dial: same game + bet type alerts once per 5-minute window
          if v_dup and exists (select 1 from public.edges
                               where event_id = v_event_id and market_key = v_mkey
                                 and created_at > now() - interval '5 minutes') then
            continue;
          end if;

          v_pinn_o := public.engine_find_outcome(v_pm, v_name, v_point);
          v_cands := v_cands || jsonb_build_array(jsonb_build_object(
            'event_id', v_event_id, 'matchup', v_matchup,
            'commence', to_char(v_commence at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
            'market', v_mkey, 'name', v_name, 'point', v_point,
            'price', v_price, 'edge', round(v_edge, 2), 'fair', v_fair,
            'book', v_rec.display_name, 'pinn_price', (v_pinn_o->>'price')::numeric));
        end loop;
      end loop;
    end loop;
  end loop;

  -- ---- insert strongest candidates first, capped per scan (anti-spam) ----
  for v_c in
    select value from jsonb_array_elements(v_cands)
    order by (value->>'edge')::numeric desc
  loop
    exit when v_created >= v_max;
    v_event_id := v_c->>'event_id';
    v_mkey := v_c->>'market';
    v_name := v_c->>'name';
    v_point := (v_c->>'point')::numeric;

    -- re-check dups: an earlier candidate in this very loop may have landed
    if exists (select 1 from public.edges
               where event_id = v_event_id and market_key = v_mkey
                 and outcome_name = v_name and point is not distinct from v_point
                 and local_book = v_c->>'book' and status = 'active') then
      continue;
    end if;
    if v_dup and exists (select 1 from public.edges
                         where event_id = v_event_id and market_key = v_mkey
                           and created_at > now() - interval '5 minutes') then
      continue;
    end if;

    v_bt := case v_mkey when 'h2h' then 'Moneyline'
                        when 'spreads' then 'Spread'
                        else 'Game Total' end;
    v_sb := left(case v_mkey
      when 'h2h' then v_name || ' ML'
      when 'spreads' then v_name || ' ' ||
        (case when v_point >= 0 then '+' else '' end) || public.engine_fmt_point(v_point)
      else v_name || ' ' || public.engine_fmt_point(v_point)
    end, 80);

    insert into public.edges (
      sport, league, matchup, bet_type, specific_bet, local_book, local_odds,
      edge_pct, game_time, alert_time, source, event_id, market_key, outcome_name, point
    ) values (
      p_sport, p_sport, v_c->>'matchup', v_bt, v_sb, v_c->>'book',
      round((v_c->>'price')::numeric)::int, round((v_c->>'edge')::numeric, 2),
      (v_c->>'commence')::timestamptz, now(), 'engine',
      v_event_id, v_mkey, v_name, v_point
    ) returning id into v_eid;

    insert into public.edge_method (edge_id, sharp_fair_price, no_vig_prob, book_lines, notes)
    values (
      v_eid,
      coalesce(public.engine_prob_to_american((v_c->>'fair')::numeric), 0),
      round((v_c->>'fair')::numeric, 5),
      jsonb_build_array(
        jsonb_build_object('book', 'No-Vig Fair', 'type', 'fair',
          'juice', public.engine_prob_to_american((v_c->>'fair')::numeric),
          'line', coalesce(public.engine_fmt_point(v_point), 'ML')),
        jsonb_build_object('book', 'Pinnacle', 'type', 'sharp',
          'juice', (v_c->>'pinn_price')::numeric,
          'line', coalesce(public.engine_fmt_point(v_point), 'ML')),
        jsonb_build_object('book', v_c->>'book', 'type', 'edge',
          'juice', (v_c->>'price')::numeric,
          'line', coalesce(public.engine_fmt_point(v_point), 'ML'))
      ),
      'Auto-detected by odds engine'
    );
    v_created := v_created + 1;
  end loop;

  if v_expired > 0 then
    insert into public.engine_runs (kind, sport, detail)
    values ('expire', p_sport, v_expired || ' edge(s) expired — line moved or edge gone');
  end if;
  return v_created;
end;
$$;

-- ============================================================
-- STEP 2a — process API responses that have arrived
-- ============================================================
create or replace function public.engine_process_pending()
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_r record; v_resp record; v_body jsonb;
  v_credits int; v_n int; v_created int;
begin
  for v_r in select * from public.engine_requests where not processed order by request_id loop
    select * into v_resp from net._http_response where id = v_r.request_id;
    if not found then
      if v_r.fired_at < now() - interval '10 minutes' then
        update public.engine_requests set processed = true where request_id = v_r.request_id;
        insert into public.engine_runs (kind, sport, detail)
        values ('error', v_r.sport, 'No API response received (network timeout)');
      end if;
      continue;
    end if;

    update public.engine_requests set processed = true where request_id = v_r.request_id;

    -- quota headers ride on every response
    begin
      v_credits := nullif(coalesce(v_resp.headers->>'x-requests-remaining',
                                   v_resp.headers->>'X-Requests-Remaining'), '')::numeric::int;
    exception when others then v_credits := null; end;
    if v_credits is not null then
      update public.engine_state set credits_remaining = v_credits, updated_at = now() where id = 1;
    end if;

    if v_resp.error_msg is not null or coalesce(v_resp.timed_out, false) then
      insert into public.engine_runs (kind, sport, detail)
      values ('error', v_r.sport, left(coalesce(v_resp.error_msg, 'Request timed out'), 200));
      continue;
    end if;

    if v_resp.status_code in (401, 403) then
      -- bad key: disable outright so we never burn requests on failures
      update public.app_config set value = 'false'::jsonb, updated_at = now() where key = 'engine_enabled';
      update public.engine_state
        set last_status = 'error', paused_reason = 'API key rejected — engine disabled', updated_at = now()
        where id = 1;
      insert into public.engine_runs (kind, sport, detail)
      values ('error', v_r.sport, 'API key rejected (HTTP ' || v_resp.status_code || ') — engine disabled');
      continue;
    end if;

    if v_resp.status_code = 429 then
      insert into public.engine_runs (kind, sport, detail)
      values ('error', v_r.sport, 'Rate limited by The Odds API — will retry next interval');
      continue;
    end if;

    if v_resp.status_code <> 200 then
      insert into public.engine_runs (kind, sport, detail)
      values ('error', v_r.sport, 'HTTP ' || coalesce(v_resp.status_code::text, '?') || ' from The Odds API');
      continue;
    end if;

    begin
      v_body := v_resp.content::jsonb;
    exception when others then
      insert into public.engine_runs (kind, sport, detail)
      values ('error', v_r.sport, 'Unparseable API response');
      continue;
    end;
    if jsonb_typeof(v_body) <> 'array' then
      insert into public.engine_runs (kind, sport, detail)
      values ('error', v_r.sport, 'Unexpected API response shape');
      continue;
    end if;

    v_n := jsonb_array_length(v_body);
    insert into public.engine_sport_state (sport, last_polled_at, last_events)
    values (v_r.sport, now(), v_n)
    on conflict (sport) do update set last_events = excluded.last_events;

    v_created := public.engine_scan_events(v_r.sport, v_body);

    insert into public.engine_runs (kind, sport, events, edges_created, credits_remaining, detail)
    values ('scan', v_r.sport, v_n, v_created, v_credits,
            v_n || ' game(s) scanned · ' || v_created || ' new edge(s)');
  end loop;

  -- housekeeping
  delete from public.engine_requests where processed and fired_at < now() - interval '1 day';
  delete from public.engine_runs where at < now() - interval '14 days';
end;
$$;

-- ============================================================
-- STEP 3 — fire new API requests when the interval elapses
-- ============================================================
create or replace function public.engine_maybe_poll()
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_interval int := coalesce((public.engine_cfg('poll_interval_minutes') #>> '{}')::int, 60);
  v_reserve int := coalesce((public.engine_cfg('credit_reserve') #>> '{}')::int, 500);
  v_state public.engine_state%rowtype;
  v_key text; v_regions text; v_url text; v_req bigint;
  v_s record; v_ss record; v_fired int := 0;
begin
  if not coalesce((public.engine_cfg('engine_enabled') #>> '{}')::boolean, false) then return; end if;

  select * into v_state from public.engine_state where id = 1;
  if v_state.last_poll_at is not null
     and v_state.last_poll_at > now() - make_interval(mins => v_interval) then
    return;
  end if;

  -- credit floor: stop polling BEFORE the monthly quota is exhausted
  if v_state.credits_remaining is not null and v_state.credits_remaining <= v_reserve then
    if coalesce(v_state.last_status, '') <> 'paused' then
      update public.engine_state
        set last_status = 'paused',
            paused_reason = 'Credit reserve reached (' || v_state.credits_remaining || ' left this month)',
            updated_at = now()
        where id = 1;
      insert into public.engine_runs (kind, detail, credits_remaining)
      values ('pause', 'Engine paused — API credit reserve reached', v_state.credits_remaining);
    end if;
    return;
  end if;

  select value into v_key from private.secrets where name = 'odds_api_key';
  if v_key is null then
    update public.engine_state
      set last_status = 'error', paused_reason = 'Odds API key not configured', updated_at = now()
      where id = 1;
    return;
  end if;

  -- regions follow the active books; eu is always included (Pinnacle lives there)
  select string_agg(distinct r, ',') into v_regions
  from (
    select m.region as r
    from public.api_book_map m
    where m.display_name in (
      select jsonb_array_elements_text(coalesce(public.engine_cfg('active_books'), '[]'::jsonb)))
    union select 'eu'
  ) t;

  for v_s in
    select s.sport, s.api_key from public.api_sport_map s
    where s.sport in (
      select jsonb_array_elements_text(coalesce(public.engine_cfg('active_sports'), '[]'::jsonb)))
  loop
    -- out-of-season sports (0 events last time) re-polled at most every 6h
    select * into v_ss from public.engine_sport_state where sport = v_s.sport;
    if found and coalesce(v_ss.last_events, -1) = 0
       and v_ss.last_polled_at > now() - interval '6 hours' then
      continue;
    end if;

    v_url := 'https://api.the-odds-api.com/v4/sports/' || v_s.api_key
          || '/odds?apiKey=' || v_key
          || '&regions=' || v_regions
          || '&markets=h2h,spreads,totals&oddsFormat=american';
    v_req := net.http_get(url := v_url, timeout_milliseconds := 15000);
    insert into public.engine_requests (request_id, sport, api_sport)
    values (v_req, v_s.sport, v_s.api_key);
    insert into public.engine_sport_state (sport, last_polled_at)
    values (v_s.sport, now())
    on conflict (sport) do update set last_polled_at = now();
    v_fired := v_fired + 1;
  end loop;

  update public.engine_state
    set last_poll_at = now(), last_status = 'running', paused_reason = null, updated_at = now()
    where id = 1;
  if v_fired > 0 then
    insert into public.engine_runs (kind, detail)
    values ('poll', 'Polled ' || v_fired || ' sport(s) [regions: ' || v_regions || ']');
  end if;
end;
$$;

-- ============================================================
-- ORCHESTRATOR — one tick, serialized, never throws
-- ============================================================
create or replace function public.engine_tick()
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not pg_try_advisory_lock(982451) then return; end if;
  begin
    perform public.engine_expire_stale();
    perform public.engine_process_pending();
    perform public.engine_maybe_poll();
  exception when others then
    begin
      insert into public.engine_runs (kind, detail) values ('error', left(sqlerrm, 300));
    exception when others then null; end;
  end;
  perform pg_advisory_unlock(982451);
end;
$$;

-- Engine functions are cron-only — not client API
revoke execute on function public.engine_tick() from public, anon, authenticated;
revoke execute on function public.engine_expire_stale() from public, anon, authenticated;
revoke execute on function public.engine_process_pending() from public, anon, authenticated;
revoke execute on function public.engine_scan_events(text, jsonb) from public, anon, authenticated;
revoke execute on function public.engine_maybe_poll() from public, anon, authenticated;
revoke execute on function public.engine_cfg(text) from public, anon;

-- ============================================================
-- SCHEDULE — every minute; engine_tick self-throttles by interval
-- ============================================================
do $$
begin
  begin perform cron.unschedule('edge-engine-tick'); exception when others then null; end;
  perform cron.schedule('edge-engine-tick', '* * * * *', 'select public.engine_tick()');
end $$;
