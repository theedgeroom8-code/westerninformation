-- 016: GAMES BOARD · QUARTER/HALF LINES · SPORTSBOOK LINE COMPARISON
--
-- Client spec (Edge Board — Developer Spec, Sep 26 2026):
--   1. Games board for NFL + CFB (Spread / Total / Moneyline, DraftKings layout)
--   2. Period lines: 1H · 2H · 1Q · 2Q · 3Q · 4Q with the same layout
--   3. Edge Detail: every book's price for the flagged market + the fair line
--
-- How it fits the existing engine (nothing here needs an external server):
--   • The full-game poll the engine ALREADY makes (h2h,spreads,totals) is now
--     also persisted into games / game_lines → the board costs zero extra credits.
--   • Period markets only exist on The Odds API's per-event endpoint. A
--     budget-governed poller (engine_maybe_poll_periods) walks games in kickoff
--     order under a daily credit cap so quota can never run away.
--   • Live scores refresh only while a board game is actually in progress.
--   • Edge detection is now period-aware (every period Pinnacle prices) and
--     edges are re-verified on every poll — including sports that are on the
--     board but not on the alert list, which fixes stale edges lingering after
--     a sport is switched off.
--   • Users never touch the tables: everything goes through security-definer
--     RPCs. The sharp book's raw prices stay admin-only; the fair line is only
--     ever returned for a market that carries an active edge.

-- ============================================================
-- EDGES — period + verification clock
-- ============================================================
alter table public.edges add column if not exists period text not null default 'FG';
do $$ begin
  alter table public.edges add constraint edges_period_chk
    check (period in ('FG','1H','2H','1Q','2Q','3Q','4Q'));
exception when duplicate_object then null; end $$;

-- Last time the engine confirmed this edge against a fresh feed. Edges nobody
-- has re-verified recently are expired (see engine_expire_stale).
alter table public.edges add column if not exists verified_at timestamptz not null default now();

-- ============================================================
-- BOARD TABLES (server-side only; clients read through RPCs)
-- ============================================================
create table if not exists public.games (
  id text primary key,                 -- The Odds API event id
  sport text not null,                 -- NFL | NCAAF
  api_sport text not null,             -- americanfootball_nfl | ..._ncaaf
  home_team text not null,
  away_team text not null,
  commence_time timestamptz not null,
  home_score int,
  away_score int,
  completed boolean not null default false,
  scores_updated_at timestamptz,
  period_polled_at timestamptz,        -- last per-event (period) fetch
  period_cost int,                     -- credits that call cost (learned; 0 = book offers no period lines)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists games_board_idx on public.games (sport, commence_time);

create table if not exists public.game_lines (
  game_id text not null references public.games(id) on delete cascade,
  period text not null check (period in ('FG','1H','2H','1Q','2Q','3Q','4Q')),
  market text not null check (market in ('h2h','h2h3','spreads','totals')),  -- h2h3 = 3-way moneyline (tie price)
  book text not null,                  -- display name ('DraftKings') or 'Pinnacle' (sharp, admin-only)
  outcomes jsonb not null,             -- [{name, price, point?}, ...] exactly as the feed sent them
  book_updated_at timestamptz,         -- when THE BOOK last touched this line (feed's last_update)
  fetched_at timestamptz not null default now(),  -- when WE last confirmed it
  primary key (game_id, period, market, book)
);

-- One tiny row per sport, touched once per ingest → the realtime signal that
-- tells open boards to refetch (game_lines itself is never broadcast).
create table if not exists public.board_state (
  sport text primary key,
  updated_at timestamptz not null default now()
);

-- Credits the period poller has spent per (Eastern) day — feeds the daily cap.
create table if not exists public.engine_period_spend (
  day date primary key,
  credits int not null default 0,
  calls int not null default 0
);

alter table public.games enable row level security;
alter table public.game_lines enable row level security;
alter table public.board_state enable row level security;
alter table public.engine_period_spend enable row level security;

drop policy if exists "games_admin" on public.games;
create policy "games_admin" on public.games for select using (public.is_admin());
drop policy if exists "game_lines_admin" on public.game_lines;
create policy "game_lines_admin" on public.game_lines for select using (public.is_admin());
drop policy if exists "board_state_read" on public.board_state;
create policy "board_state_read" on public.board_state for select to authenticated using (true);
drop policy if exists "period_spend_admin" on public.engine_period_spend;
create policy "period_spend_admin" on public.engine_period_spend for select using (public.is_admin());

do $$
begin
  begin alter publication supabase_realtime add table public.board_state; exception when duplicate_object then null; end;
end $$;

-- Engine bookkeeping
alter table public.engine_requests add column if not exists event_id text;
alter table public.engine_state add column if not exists last_live_scores_at timestamptz;

-- ============================================================
-- CONFIG SEEDS (Admin → Config)
-- ============================================================
-- Period defaults are deliberately modest: on the current 20,000-credit plan the
-- regular 15-minute poll already uses ~17.6k/month, so quarter/half fetching
-- must stay small (see BOARD-GUIDE.md for the credit math per plan tier).
insert into public.app_config (key, value) values
  ('board_sports',               '["NFL","NCAAF"]'::jsonb),
  ('board_book_priority',        '["DraftKings","FanDuel","BetMGM","Caesars","Circa","Wynn"]'::jsonb),
  ('period_lines_enabled',       'true'::jsonb),   -- fetch + show quarter/half lines
  ('period_edges_enabled',       'true'::jsonb),   -- ALSO alert on quarter/half edges (kill switch)
  ('period_refresh_minutes',     '120'::jsonb),
  ('period_window_hours',        '12'::jsonb),
  ('period_daily_credit_cap',    '400'::jsonb),
  ('live_score_refresh_minutes', '10'::jsonb)
on conflict (key) do nothing;

-- first rollout used 30h / 800 — a burst that spent the day's cap in 35 minutes
update public.app_config set value = '12'::jsonb where key = 'period_window_hours' and value = '30'::jsonb;
update public.app_config set value = '400'::jsonb where key = 'period_daily_credit_cap' and value = '800'::jsonb;

-- ============================================================
-- PURE HELPERS
-- ============================================================
-- 'spreads_h1' → {spreads,1H} · 'h2h_3_way_q3' → {h2h3,3Q} · 'totals' → {totals,FG} · else null
create or replace function public.engine_market_parts(p_key text)
returns text[]
language sql immutable
as $$
  select case
    when p_key in ('h2h','spreads','totals') then array[p_key, 'FG']
    else (
      select array[
        case t.m[1] when 'h2h_3_way' then 'h2h3' else t.m[1] end,
        case t.m[2] when 'q1' then '1Q' when 'q2' then '2Q' when 'q3' then '3Q'
                    when 'q4' then '4Q' when 'h1' then '1H' when 'h2' then '2H' end
      ]
      from (select regexp_match(p_key, '^(h2h_3_way|h2h|spreads|totals)_(q[1-4]|h[12])$') as m) t
      where t.m is not null
    )
  end
$$;

-- inverse: ('spreads','1H') → 'spreads_h1'
create or replace function public.engine_api_market(p_base text, p_period text)
returns text
language sql immutable
as $$
  select case
    when p_period = 'FG' then p_base
    else (case p_base when 'h2h3' then 'h2h_3_way' else p_base end) || '_' ||
         (case p_period when '1Q' then 'q1' when '2Q' then 'q2' when '3Q' then 'q3'
                        when '4Q' then 'q4' when '1H' then 'h1' when '2H' then 'h2' end)
  end
$$;

create or replace function public.engine_period_label(p_period text)
returns text
language sql immutable
as $$
  select case p_period when '1H' then '1st Half' when '2H' then '2nd Half'
                       when '1Q' then '1st Quarter' when '2Q' then '2nd Quarter'
                       when '3Q' then '3rd Quarter' when '4Q' then '4th Quarter' end
$$;

create or replace function public.engine_cfg_int(p_key text, p_default int)
returns int
language sql stable
set search_path = public
as $$
  select coalesce((select (value #>> '{}')::int from public.app_config where key = p_key), p_default)
$$;

create or replace function public.engine_cfg_list(p_key text)
returns text[]
language sql stable
set search_path = public
as $$
  select coalesce(
    (select array_agg(x) from public.app_config c, jsonb_array_elements_text(c.value) t(x) where c.key = p_key),
    '{}')
$$;

-- ============================================================
-- INGEST — persist a feed response into games / game_lines
-- ============================================================
-- p_events: array of Odds-API event objects (sport-level response, or a
-- one-element array wrapping a per-event response).
-- p_periods: which periods this response speaks for. Lines of those periods
-- that the response did NOT contain are deleted (the book pulled the market),
-- so a stale price can never masquerade as a live one.
create or replace function public.board_ingest_events(
  p_sport text, p_api_sport text, p_events jsonb, p_periods text[]
)
returns int
language plpgsql security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_ev jsonb; v_b jsonb; v_m jsonb;
  v_id text; v_commence timestamptz; v_home text; v_away text;
  v_display text; v_parts text[]; v_outs jsonb; v_upd timestamptz;
  v_n int := 0;
begin
  for v_ev in select value from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) loop
    v_id := v_ev->>'id';
    v_home := v_ev->>'home_team';
    v_away := v_ev->>'away_team';
    begin v_commence := (v_ev->>'commence_time')::timestamptz; exception when others then v_commence := null; end;
    if v_id is null or v_home is null or v_away is null or v_commence is null then continue; end if;

    insert into public.games (id, sport, api_sport, home_team, away_team, commence_time, updated_at)
    values (v_id, p_sport, p_api_sport, v_home, v_away, v_commence, v_now)
    on conflict (id) do update
      set sport = excluded.sport, api_sport = excluded.api_sport,
          home_team = excluded.home_team, away_team = excluded.away_team,
          commence_time = excluded.commence_time, updated_at = excluded.updated_at;

    for v_b in select value from jsonb_array_elements(coalesce(v_ev->'bookmakers', '[]'::jsonb)) loop
      v_display := case when v_b->>'key' = 'pinnacle' then 'Pinnacle'
                        else (select m.display_name from public.api_book_map m where m.api_key = v_b->>'key' limit 1) end;
      if v_display is null then continue; end if;

      for v_m in select value from jsonb_array_elements(coalesce(v_b->'markets', '[]'::jsonb)) loop
        v_parts := public.engine_market_parts(v_m->>'key');
        if v_parts is null or not (v_parts[2] = any(p_periods)) then continue; end if;
        v_outs := v_m->'outcomes';
        if v_outs is null or jsonb_typeof(v_outs) <> 'array' or jsonb_array_length(v_outs) = 0 then continue; end if;
        begin
          v_upd := coalesce((v_m->>'last_update')::timestamptz, (v_b->>'last_update')::timestamptz, v_now);
        exception when others then v_upd := v_now; end;

        insert into public.game_lines (game_id, period, market, book, outcomes, book_updated_at, fetched_at)
        values (v_id, v_parts[2], v_parts[1], v_display, v_outs, v_upd, v_now)
        on conflict (game_id, period, market, book) do update
          set outcomes = excluded.outcomes,
              book_updated_at = excluded.book_updated_at,
              fetched_at = excluded.fetched_at;
      end loop;
    end loop;

    -- anything in the covered periods this response no longer carries is gone
    delete from public.game_lines
      where game_id = v_id and period = any(p_periods) and fetched_at < v_now;
    v_n := v_n + 1;
  end loop;

  insert into public.board_state (sport, updated_at) values (p_sport, v_now)
  on conflict (sport) do update set updated_at = excluded.updated_at;
  return v_n;
end;
$$;

-- Scores payload → games (live score + completed flag)
create or replace function public.board_apply_scores(p_events jsonb)
returns int
language plpgsql security definer
set search_path = public
as $$
declare v_n int;
begin
  with upd as (
    update public.games g set
      completed = coalesce((e.value->>'completed')::boolean, false),
      home_score = (select case when s.value->>'score' ~ '^\d+$' then (s.value->>'score')::int end
                    from jsonb_array_elements(e.value->'scores') s where s.value->>'name' = g.home_team limit 1),
      away_score = (select case when s.value->>'score' ~ '^\d+$' then (s.value->>'score')::int end
                    from jsonb_array_elements(e.value->'scores') s where s.value->>'name' = g.away_team limit 1),
      scores_updated_at = now()
    from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) e
    where g.id = e.value->>'id' and jsonb_typeof(e.value->'scores') = 'array'
    returning 1
  )
  select count(*) into v_n from upd;
  if v_n > 0 then
    insert into public.board_state (sport, updated_at)
    select distinct sport, now() from public.games where scores_updated_at >= now() - interval '1 minute'
    on conflict (sport) do update set updated_at = excluded.updated_at;
  end if;
  return v_n;
end;
$$;

-- ============================================================
-- EDGE SCAN v3 — period-aware, verify-everywhere / hunt-only-when-monitored
-- ============================================================
-- p_hunt    : false → only re-verify existing edges (sport is on the board but
--             not on the alert list); true → also publish new edges.
-- p_periods : which periods this response covers (verification and hunting are
--             both scoped to them — a per-event response has no full-game
--             markets and must not expire full-game edges).
drop function if exists public.engine_scan_events(text, jsonb);

create or replace function public.engine_scan_events(
  p_sport text, p_events jsonb, p_hunt boolean default true, p_periods text[] default array['FG']
)
returns int
language plpgsql security definer
set search_path = public
as $$
declare
  v_threshold numeric := coalesce((public.engine_cfg('min_edge_threshold') #>> '{}')::numeric, 2.0);
  v_cutoff int := coalesce((public.engine_cfg('pre_game_cutoff_minutes') #>> '{}')::int, 30);
  v_dup boolean := coalesce((public.engine_cfg('duplicate_suppression') #>> '{}')::boolean, true);
  v_max int := coalesce((public.engine_cfg('max_edges_per_scan') #>> '{}')::int, 8);
  v_band numeric := coalesce((public.engine_cfg('max_abs_odds') #>> '{}')::numeric, 350);
  v_period_edges boolean := coalesce((public.engine_cfg('period_edges_enabled') #>> '{}')::boolean, true);
  v_active_books text[];
  v_cands jsonb := '[]'::jsonb;
  v_created int := 0;
  v_expired int := 0;
  v_ev jsonb; v_pinn jsonb; v_pm jsonb; v_lm jsonb; v_lo jsonb; v_pinn_o jsonb;
  v_ex public.edges%rowtype;
  v_rec record;
  v_event_id text; v_matchup text; v_home text; v_away text;
  v_commence timestamptz;
  v_period text; v_mkey text; v_akey text; v_name text; v_point numeric; v_price numeric;
  v_fair numeric; v_dec numeric; v_edge numeric;
  v_bk jsonb; v_c jsonb; v_eid uuid; v_bt text; v_sb text; v_pl text;
begin
  select coalesce(array_agg(x), '{}') into v_active_books
  from jsonb_array_elements_text(coalesce(public.engine_cfg('active_books'), '[]'::jsonb)) t(x);

  for v_ev in select value from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) loop
    v_event_id := v_ev->>'id';
    begin v_commence := (v_ev->>'commence_time')::timestamptz; exception when others then v_commence := null; end;
    v_home := v_ev->>'home_team';
    v_away := v_ev->>'away_team';
    if v_event_id is null or v_commence is null or v_home is null then continue; end if;
    v_matchup := left(v_away || ' @ ' || v_home, 120);

    v_pinn := (select b.value from jsonb_array_elements(coalesce(v_ev->'bookmakers','[]'::jsonb)) b
               where b.value->>'key' = 'pinnacle' limit 1);

    -- ---- (A) verify EXISTING engine edges in the covered periods ----
    if v_pinn is not null then
      for v_ex in select * from public.edges
                  where event_id = v_event_id and source = 'engine' and status = 'active'
                    and period = any(p_periods) loop
        v_akey := public.engine_api_market(v_ex.market_key, v_ex.period);
        v_pm := public.engine_find_market(v_pinn, v_akey);
        v_fair := public.engine_outcome_fair(v_pm, v_ex.outcome_name, v_ex.point);
        select b.value into v_bk
          from jsonb_array_elements(coalesce(v_ev->'bookmakers','[]'::jsonb)) b
          join public.api_book_map m on m.api_key = b.value->>'key'
          where m.display_name = v_ex.local_book limit 1;
        v_lo := public.engine_find_outcome(
                  public.engine_find_market(v_bk, v_akey), v_ex.outcome_name, v_ex.point);
        if v_fair is null or v_lo is null or abs(v_ex.local_odds) > v_band then
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
              set local_odds = round(v_price)::int, edge_pct = round(v_edge, 2), verified_at = now()
              where id = v_ex.id;
          else
            update public.edges set verified_at = now() where id = v_ex.id;
          end if;
        end if;
      end loop;
    end if;

    -- ---- (B) hunt for NEW edges ----
    if not p_hunt or v_pinn is null then continue; end if;
    if v_commence <= now() + make_interval(mins => v_cutoff) then continue; end if;

    foreach v_period in array p_periods loop
      -- admin kill switch: quarter/half lines can be shown without alerting on them
      if v_period <> 'FG' and not v_period_edges then continue; end if;
      foreach v_mkey in array array['h2h','spreads','totals'] loop
        v_akey := public.engine_api_market(v_mkey, v_period);
        v_pm := public.engine_find_market(v_pinn, v_akey);
        if v_pm is null or jsonb_array_length(coalesce(v_pm->'outcomes','[]'::jsonb)) <> 2 then continue; end if;

        -- longshot guard: BOTH sharp sides must sit inside the price band
        if (select bool_or(abs((o.value->>'price')::numeric) > v_band)
            from jsonb_array_elements(v_pm->'outcomes') o) then
          continue;
        end if;

        for v_rec in
          select b.value as book, m.display_name
          from jsonb_array_elements(coalesce(v_ev->'bookmakers','[]'::jsonb)) b
          join public.api_book_map m on m.api_key = b.value->>'key'
          where m.display_name = any(v_active_books)
        loop
          v_lm := public.engine_find_market(v_rec.book, v_akey);
          if v_lm is null then continue; end if;

          for v_lo in select value from jsonb_array_elements(coalesce(v_lm->'outcomes','[]'::jsonb)) loop
            v_name := v_lo->>'name';
            v_point := (v_lo->>'point')::numeric;
            v_price := (v_lo->>'price')::numeric;
            if v_name is null or v_price is null then continue; end if;
            if abs(v_price) < 100 or abs(v_price) > v_band then continue; end if;

            v_fair := public.engine_outcome_fair(v_pm, v_name, v_point);
            if v_fair is null then continue; end if;   -- different line than the sharp book

            v_dec := case when v_price > 0 then 1 + v_price/100 else 1 + 100/abs(v_price) end;
            v_edge := (v_fair * v_dec - 1) * 100;
            if v_edge < v_threshold then continue; end if;
            if v_edge > 20 then continue; end if;      -- stale/erroneous feed guard

            if exists (select 1 from public.edges
                       where event_id = v_event_id and market_key = v_mkey and period = v_period
                         and outcome_name = v_name and point is not distinct from v_point
                         and local_book = v_rec.display_name and status = 'active') then
              continue;
            end if;
            if v_dup and exists (select 1 from public.edges
                                 where event_id = v_event_id and market_key = v_mkey and period = v_period
                                   and created_at > now() - interval '5 minutes') then
              continue;
            end if;

            v_pinn_o := public.engine_find_outcome(v_pm, v_name, v_point);
            v_cands := v_cands || jsonb_build_array(jsonb_build_object(
              'event_id', v_event_id, 'matchup', v_matchup, 'period', v_period,
              'commence', to_char(v_commence at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
              'market', v_mkey, 'name', v_name, 'point', v_point,
              'price', v_price, 'edge', round(v_edge, 2), 'fair', v_fair,
              'book', v_rec.display_name, 'pinn_price', (v_pinn_o->>'price')::numeric));
          end loop;
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
    v_period := v_c->>'period';
    v_name := v_c->>'name';
    v_point := (v_c->>'point')::numeric;

    if exists (select 1 from public.edges
               where event_id = v_event_id and market_key = v_mkey and period = v_period
                 and outcome_name = v_name and point is not distinct from v_point
                 and local_book = v_c->>'book' and status = 'active') then
      continue;
    end if;
    if v_dup and exists (select 1 from public.edges
                         where event_id = v_event_id and market_key = v_mkey and period = v_period
                           and created_at > now() - interval '5 minutes') then
      continue;
    end if;

    v_bt := coalesce(public.engine_period_label(v_period) || ' ', '') ||
            (case v_mkey when 'h2h' then 'Moneyline'
                         when 'spreads' then 'Spread'
                         else (case when v_period = 'FG' then 'Game Total' else 'Total' end) end);
    v_pl := case when v_period = 'FG' then '' else v_period || ' ' end;
    v_sb := left(v_pl || case v_mkey
      when 'h2h' then v_name || ' ML'
      when 'spreads' then v_name || ' ' ||
        (case when v_point >= 0 then '+' else '' end) || public.engine_fmt_point(v_point)
      else v_name || ' ' || public.engine_fmt_point(v_point)
    end, 80);

    insert into public.edges (
      sport, league, matchup, bet_type, specific_bet, local_book, local_odds,
      edge_pct, game_time, alert_time, source, event_id, market_key, outcome_name, point, period
    ) values (
      p_sport, p_sport, v_c->>'matchup', v_bt, v_sb, v_c->>'book',
      round((v_c->>'price')::numeric)::int, round((v_c->>'edge')::numeric, 2),
      (v_c->>'commence')::timestamptz, now(), 'engine',
      v_event_id, v_mkey, v_name, v_point, v_period
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
      'Auto-detected by odds engine' || case when v_period = 'FG' then '' else ' (' || v_period || ')' end
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
-- SETTLEMENT GUARD — period plays can't be graded from a final score
-- ============================================================
-- A 1st-half or 1st-quarter edge cannot be graded from the FINAL score, and
-- The Odds API scores carry no per-period breakdown. Auto-settle is therefore
-- limited to full-game plays; period plays are settled by hand (unchanged UX).
create or replace function public.engine_apply_scores(p_events jsonb)
returns int
language plpgsql security definer
set search_path = public
as $$
declare
  v_ev jsonb; v_home text; v_away text; v_hs numeric; v_as numeric;
  v_bet record; v_res text; v_settled int := 0;
  v_team numeric; v_opp numeric; v_total numeric;
begin
  for v_ev in select value from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) loop
    if not coalesce((v_ev->>'completed')::boolean, false) then continue; end if;
    if v_ev->'scores' is null or jsonb_typeof(v_ev->'scores') <> 'array' then continue; end if;

    v_home := v_ev->>'home_team';
    v_away := v_ev->>'away_team';
    select (s.value->>'score')::numeric into v_hs
      from jsonb_array_elements(v_ev->'scores') s where s.value->>'name' = v_home;
    select (s.value->>'score')::numeric into v_as
      from jsonb_array_elements(v_ev->'scores') s where s.value->>'name' = v_away;
    if v_hs is null or v_as is null then continue; end if;

    for v_bet in
      select b.id as bet_id, e.market_key, e.outcome_name, e.point
      from public.bets b
      join public.edges e on e.id = b.edge_id
      where b.result is null and e.event_id = v_ev->>'id' and e.period = 'FG'
    loop
      v_res := null;

      if v_bet.market_key = 'h2h' then
        if v_hs = v_as then v_res := 'push';
        elsif (v_hs > v_as and v_bet.outcome_name = v_home)
           or (v_as > v_hs and v_bet.outcome_name = v_away) then v_res := 'win';
        elsif v_bet.outcome_name in (v_home, v_away) then v_res := 'loss';
        end if;

      elsif v_bet.market_key = 'spreads' and v_bet.point is not null then
        v_team := case when v_bet.outcome_name = v_home then v_hs
                       when v_bet.outcome_name = v_away then v_as end;
        v_opp  := case when v_bet.outcome_name = v_home then v_as
                       when v_bet.outcome_name = v_away then v_hs end;
        if v_team is not null then
          if v_team + v_bet.point > v_opp then v_res := 'win';
          elsif v_team + v_bet.point = v_opp then v_res := 'push';
          else v_res := 'loss'; end if;
        end if;

      elsif v_bet.market_key = 'totals' and v_bet.point is not null then
        v_total := v_hs + v_as;
        if v_total = v_bet.point then v_res := 'push';
        elsif (v_bet.outcome_name = 'Over' and v_total > v_bet.point)
           or (v_bet.outcome_name = 'Under' and v_total < v_bet.point) then v_res := 'win';
        elsif v_bet.outcome_name in ('Over','Under') then v_res := 'loss';
        end if;
      end if;

      if v_res is not null and public.engine_settle_bet(v_bet.bet_id, v_res) then
        v_settled := v_settled + 1;
      end if;
    end loop;
  end loop;
  return v_settled;
end;
$$;

-- auto-settle sweep must not chase period plays either
create or replace function public.engine_maybe_settle()
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_state public.engine_state%rowtype;
  v_key text; v_url text; v_req bigint; v_s record; v_fired int := 0;
begin
  select * into v_state from public.engine_state where id = 1;
  if v_state.last_scores_poll_at is not null
     and v_state.last_scores_poll_at > now() - interval '60 minutes' then
    return;
  end if;

  if not exists (
    select 1 from public.bets b
    join public.edges e on e.id = b.edge_id
    where b.result is null and e.event_id is not null and e.period = 'FG'
      and e.game_time < now() - interval '2 hours'
  ) then
    return;
  end if;

  select value into v_key from private.secrets where name = 'odds_api_key';
  if v_key is null then return; end if;

  for v_s in
    select distinct m.api_key, m.sport
    from public.api_sport_map m
    join (
      select distinct e.sport
      from public.bets b
      join public.edges e on e.id = b.edge_id
      where b.result is null and e.event_id is not null and e.period = 'FG'
        and e.game_time < now() - interval '2 hours'
    ) waiting on waiting.sport = m.sport
  loop
    v_url := 'https://api.the-odds-api.com/v4/sports/' || v_s.api_key
          || '/scores/?daysFrom=3&apiKey=' || v_key;
    v_req := net.http_get(url := v_url, timeout_milliseconds := 15000);
    insert into public.engine_requests (request_id, sport, api_sport, req_type)
    values (v_req, v_s.sport, v_s.api_key, 'scores');
    v_fired := v_fired + 1;
  end loop;

  update public.engine_state set last_scores_poll_at = now(), updated_at = now() where id = 1;
  if v_fired > 0 then
    insert into public.engine_runs (kind, detail)
    values ('poll', 'Requested final scores for ' || v_fired || ' feed(s)');
  end if;
end;
$$;

-- ============================================================
-- EXPIRY — game start, unverified edges, old games
-- ============================================================
create or replace function public.engine_expire_stale()
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_n int;
  v_fg int := public.engine_cfg_int('poll_interval_minutes', 60);
  v_per int := public.engine_cfg_int('period_refresh_minutes', 120);
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

  -- An engine edge the feed hasn't confirmed lately can't be trusted (sport
  -- switched off, engine paused, book/sharp line vanished, period budget spent).
  -- Full game: ~3 polling cycles. Half/quarter lines move faster and are fetched
  -- less often, so they get 2 refresh cycles (min 2.5h) before they're pulled.
  with upd as (
    update public.edges set status = 'expired'
    where status = 'active' and source = 'engine'
      and verified_at < now() - make_interval(mins =>
            case when period = 'FG' then greatest(v_fg * 3, 45) else greatest(v_per * 2, 150) end)
    returning 1
  )
  select count(*) into v_n from upd;
  if v_n > 0 then
    insert into public.engine_runs (kind, detail)
    values ('expire', v_n || ' edge(s) expired — no fresh confirmation from the feed');
  end if;

  delete from public.games where commence_time < now() - interval '3 days';
  delete from public.engine_period_spend where day < (now() - interval '60 days')::date;
end;
$$;

-- ============================================================
-- POLL — full-game odds for every monitored OR board sport
-- ============================================================
-- Uses `bookmakers=` instead of `regions=`: The Odds API bills each group of up
-- to 10 bookmakers as ONE region, so the same books + Pinnacle cost half of the
-- old regions=eu,us call (3 credits per sport instead of 6). Verified live.
create or replace function public.engine_maybe_poll()
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_interval int := coalesce((public.engine_cfg('poll_interval_minutes') #>> '{}')::int, 60);
  v_reserve int := coalesce((public.engine_cfg('credit_reserve') #>> '{}')::int, 500);
  v_state public.engine_state%rowtype;
  v_key text; v_books text; v_url text; v_req bigint;
  v_s record; v_ss record; v_fired int := 0;
begin
  if not coalesce((public.engine_cfg('engine_enabled') #>> '{}')::boolean, false) then return; end if;

  select * into v_state from public.engine_state where id = 1;
  if v_state.last_poll_at is not null
     and v_state.last_poll_at > now() - make_interval(mins => v_interval) then
    return;
  end if;

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

  -- monitored books + the sharp benchmark, as a bookmakers list
  select string_agg(distinct k, ',') into v_books
  from (
    select m.api_key as k from public.api_book_map m
    where m.display_name = any(public.engine_cfg_list('active_books'))
    union select 'pinnacle'
  ) t;

  for v_s in
    select s.sport, s.api_key from public.api_sport_map s
    where s.sport = any(public.engine_cfg_list('active_sports'))
       or s.sport = any(public.engine_cfg_list('board_sports'))
  loop
    -- feeds with no events (off-season) re-polled at most every 6h
    select * into v_ss from public.engine_sport_state where sport = v_s.api_key;
    if found and coalesce(v_ss.last_events, -1) = 0
       and v_ss.last_polled_at > now() - interval '6 hours' then
      continue;
    end if;

    v_url := 'https://api.the-odds-api.com/v4/sports/' || v_s.api_key
          || '/odds?apiKey=' || v_key
          || '&bookmakers=' || v_books
          || '&markets=h2h,spreads,totals&oddsFormat=american';
    v_req := net.http_get(url := v_url, timeout_milliseconds := 15000);
    insert into public.engine_requests (request_id, sport, api_sport, req_type)
    values (v_req, v_s.sport, v_s.api_key, 'odds');
    insert into public.engine_sport_state (sport, last_polled_at)
    values (v_s.api_key, now())
    on conflict (sport) do update set last_polled_at = now();
    v_fired := v_fired + 1;
  end loop;

  update public.engine_state
    set last_poll_at = now(), last_status = 'running', paused_reason = null, updated_at = now()
    where id = 1;
  if v_fired > 0 then
    insert into public.engine_runs (kind, detail)
    values ('poll', 'Polled ' || v_fired || ' feed(s) [books: ' || v_books || ']');
  end if;
end;
$$;

-- ============================================================
-- POLL — quarter / half lines, per event, under a daily credit cap
-- ============================================================
-- Period markets exist only on /events/{id}/odds and cost (markets returned ×
-- bookmaker groups) credits per call — roughly 21 for an NFL game. So:
--   • only pregame games kicking off within period_window_hours
--   • soonest kickoff first; each game refreshed every period_refresh_minutes
--   • hard daily cap (period_daily_credit_cap), additionally never more than
--     10% of the credits left above the reserve per day
--   • paced: at most a quarter of the daily cap in any rolling hour, so the day's
--     budget isn't burned in one burst and near-kickoff games stay fresh later
--   • games whose books offer no period lines (cost 0) are re-checked rarely
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
  select coalesce(sum(coalesce(period_cost, 24)), 0) into v_recent
    from public.games where period_polled_at > now() - interval '60 minutes';
  v_hourly := greatest(ceil(v_cap / 4.0)::int, 50);
  v_budget := least(v_cap - v_spent - v_inflight * 24, v_hourly - v_recent);
  if v_budget < 6 then return; end if;

  select value into v_key from private.secrets where name = 'odds_api_key';
  if v_key is null then return; end if;

  select string_agg(distinct k, ',') into v_books
  from (
    select m.api_key as k from public.api_book_map m
    where m.display_name = any(public.engine_cfg_list('active_books'))
    union select 'pinnacle'
  ) t;

  select string_agg(public.engine_api_market(b, p), ',') into v_markets
  from unnest(array['h2h','h2h3','spreads','totals']) b,
       unnest(array['1H','2H','1Q','2Q','3Q','4Q']) p;

  for v_g in
    select g.id, g.api_sport, g.sport, coalesce(g.period_cost, 24) as est
    from public.games g
    where g.sport = any(public.engine_cfg_list('board_sports'))
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

-- ============================================================
-- POLL — live scores, only while a board game is in progress
-- ============================================================
create or replace function public.engine_maybe_scores_live()
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_every int := public.engine_cfg_int('live_score_refresh_minutes', 10);
  v_reserve int := public.engine_cfg_int('credit_reserve', 500);
  v_state public.engine_state%rowtype;
  v_key text; v_g record; v_req bigint;
begin
  if v_every <= 0 then return; end if;
  if not coalesce((public.engine_cfg('engine_enabled') #>> '{}')::boolean, false) then return; end if;

  select * into v_state from public.engine_state where id = 1;
  if v_state.last_live_scores_at is not null
     and v_state.last_live_scores_at > now() - make_interval(mins => v_every) then
    return;
  end if;
  if v_state.credits_remaining is not null and v_state.credits_remaining <= v_reserve then return; end if;

  select value into v_key from private.secrets where name = 'odds_api_key';
  if v_key is null then return; end if;

  for v_g in
    select distinct g.api_sport, g.sport
    from public.games g
    where g.sport = any(public.engine_cfg_list('board_sports'))
      and g.commence_time <= now() and g.commence_time > now() - interval '5 hours'
      and not g.completed
  loop
    v_req := net.http_get(
      url := 'https://api.the-odds-api.com/v4/sports/' || v_g.api_sport || '/scores/?daysFrom=1&apiKey=' || v_key,
      timeout_milliseconds := 15000);
    insert into public.engine_requests (request_id, sport, api_sport, req_type)
    values (v_req, v_g.sport, v_g.api_sport, 'scores_live');
    update public.engine_state set last_live_scores_at = now() where id = 1;
  end loop;
end;
$$;

-- ============================================================
-- PROCESS — route every response type
-- ============================================================
create or replace function public.engine_process_pending()
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_r record; v_resp record; v_body jsonb;
  v_credits int; v_cost int; v_n int; v_created int; v_settled int;
  v_board text[] := public.engine_cfg_list('board_sports');
  v_active text[] := public.engine_cfg_list('active_sports');
  v_periods text[] := array['1H','2H','1Q','2Q','3Q','4Q'];
  v_day date := (now() at time zone 'America/New_York')::date;
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

    -- Each response is handled in its own sub-transaction: a payload that blows
    -- up can be logged and skipped, but can never roll back the whole engine
    -- tick (which would re-fail every minute and stop all polling behind it).
    begin
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
    -- a per-event response is ONE object; every other endpoint returns an array
    if v_r.req_type = 'period' and jsonb_typeof(v_body) = 'object' then
      v_body := jsonb_build_array(v_body);
    end if;
    if jsonb_typeof(v_body) <> 'array' then
      insert into public.engine_runs (kind, sport, detail)
      values ('error', v_r.sport, 'Unexpected API response shape');
      continue;
    end if;

    v_n := jsonb_array_length(v_body);

    if v_r.req_type = 'scores' or v_r.req_type = 'scores_live' then
      v_settled := public.engine_apply_scores(v_body);
      begin
        perform public.board_apply_scores(v_body);
      exception when others then
        insert into public.engine_runs (kind, sport, detail)
        values ('error', v_r.sport, left('Board scores failed: ' || sqlerrm, 200));
      end;
      if v_r.req_type = 'scores' or v_settled > 0 then
        insert into public.engine_runs (kind, sport, events, edges_created, credits_remaining, detail)
        values ('settle', v_r.sport, v_n, v_settled,
                v_credits, v_settled || ' bet(s) auto-settled from final scores');
      end if;

    elsif v_r.req_type = 'period' then
      begin
        v_cost := nullif(coalesce(v_resp.headers->>'x-requests-last',
                                  v_resp.headers->>'X-Requests-Last'), '')::numeric::int;
      exception when others then v_cost := null; end;
      update public.games set period_cost = coalesce(v_cost, period_cost) where id = v_r.event_id;
      insert into public.engine_period_spend (day, credits, calls) values (v_day, coalesce(v_cost, 0), 1)
      on conflict (day) do update
        set credits = public.engine_period_spend.credits + excluded.credits,
            calls = public.engine_period_spend.calls + 1;
      begin
        perform public.board_ingest_events(v_r.sport, v_r.api_sport, v_body, v_periods);
      exception when others then
        insert into public.engine_runs (kind, sport, detail)
        values ('error', v_r.sport, left('Board ingest failed: ' || sqlerrm, 200));
      end;
      v_created := public.engine_scan_events(v_r.sport, v_body, v_r.sport = any(v_active), v_periods);
      if v_created > 0 then
        insert into public.engine_runs (kind, sport, events, edges_created, credits_remaining, detail)
        values ('scan', v_r.sport, v_n, v_created, v_credits,
                'Half/quarter lines scanned · ' || v_created || ' new edge(s)');
      end if;

    else
      insert into public.engine_sport_state (sport, last_polled_at, last_events)
      values (v_r.api_sport, now(), v_n)
      on conflict (sport) do update set last_events = excluded.last_events;

      if v_r.sport = any(v_board) then
        begin
          perform public.board_ingest_events(v_r.sport, v_r.api_sport, v_body, array['FG']);
        exception when others then
          insert into public.engine_runs (kind, sport, detail)
          values ('error', v_r.sport, left('Board ingest failed: ' || sqlerrm, 200));
        end;
      end if;

      -- verification always runs; new-edge hunting only for monitored sports
      v_created := public.engine_scan_events(v_r.sport, v_body, v_r.sport = any(v_active), array['FG']);

      insert into public.engine_runs (kind, sport, events, edges_created, credits_remaining, detail)
      values ('scan', v_r.sport, v_n, v_created, v_credits,
              v_n || ' game(s) scanned · ' || v_created || ' new edge(s)');
    end if;
    exception when others then
      insert into public.engine_runs (kind, sport, detail)
      values ('error', v_r.sport, left('Response skipped — ' || sqlerrm, 200));
    end;
  end loop;

  delete from public.engine_requests where processed and fired_at < now() - interval '1 day';
  delete from public.engine_runs where at < now() - interval '14 days';
end;
$$;

-- ============================================================
-- ORCHESTRATOR
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
    perform public.engine_maybe_poll_periods();
    perform public.engine_maybe_scores_live();
    perform public.engine_maybe_settle();
  exception when others then
    begin
      insert into public.engine_runs (kind, detail) values ('error', left(sqlerrm, 300));
    exception when others then null; end;
  end;
  perform pg_advisory_unlock(982451);
end;
$$;

-- ============================================================
-- CLIENT RPCs — the only way users read the board
-- ============================================================

-- One market's price for one side at every visible book (raw, unsorted — the
-- app ranks them). p_sharp adds the sharp book (admin callers only).
create or replace function public.board_line_rows(
  p_game_id text, p_period text, p_market text, p_outcome text,
  p_books text[], p_stale_min int, p_sharp boolean
)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'book', gl.book,
    'point', o.value->'point',
    'price', o.value->'price',
    'updatedAt', gl.book_updated_at,
    'stale', least(gl.book_updated_at, gl.fetched_at) < now() - make_interval(mins => p_stale_min),
    'sharp', gl.book = 'Pinnacle'
  ) order by gl.book), '[]'::jsonb)
  from public.game_lines gl
  cross join lateral jsonb_array_elements(gl.outcomes) o
  where gl.game_id = p_game_id and gl.period = p_period and gl.market = p_market
    and o.value->>'name' = p_outcome
    and (gl.book = any(p_books) or (p_sharp and gl.book = 'Pinnacle'))
$$;

create or replace function public.board_games(p_sport text, p_period text default 'FG')
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_books text[]; v_prio text[]; v_fg int; v_per int; v_stale int;
  v_games jsonb; v_upd timestamptz;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if p_period not in ('FG','1H','2H','1Q','2Q','3Q','4Q') then raise exception 'Unknown period'; end if;

  v_fg := public.engine_cfg_int('poll_interval_minutes', 15);
  v_per := public.engine_cfg_int('period_refresh_minutes', 120);
  v_stale := 2 * case when p_period = 'FG' then v_fg else v_per end;

  if not (p_sport = any(public.engine_cfg_list('board_sports'))) then
    return jsonb_build_object('games', '[]'::jsonb, 'meta', jsonb_build_object(
      'enabled', false, 'staleMin', v_stale,
      'periodEnabled', false, 'periodWindowHours', public.engine_cfg_int('period_window_hours', 30)));
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
      'periodWindowHours', public.engine_cfg_int('period_window_hours', 30)
    ));
end;
$$;

-- Comparison for a board cell (no edge involved → no fair line, by design).
create or replace function public.market_comparison(
  p_game_id text, p_period text, p_market text, p_outcome text
)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_g public.games%rowtype; v_stale int; v_books text[]; v_admin boolean := public.is_admin();
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if p_period not in ('FG','1H','2H','1Q','2Q','3Q','4Q') then raise exception 'Unknown period'; end if;
  if p_market not in ('h2h','h2h3','spreads','totals') then raise exception 'Unknown market'; end if;
  select * into v_g from public.games where id = p_game_id;
  if not found then return null; end if;

  v_stale := 2 * case when p_period = 'FG' then public.engine_cfg_int('poll_interval_minutes', 15)
                      else public.engine_cfg_int('period_refresh_minutes', 120) end;
  v_books := public.engine_cfg_list('active_books');

  return jsonb_build_object(
    'game', jsonb_build_object(
      'id', v_g.id, 'sport', v_g.sport, 'home', v_g.home_team, 'away', v_g.away_team,
      'commence', v_g.commence_time, 'homeScore', v_g.home_score, 'awayScore', v_g.away_score,
      'completed', v_g.completed),
    'period', p_period, 'market', p_market, 'outcome', p_outcome,
    'staleMin', v_stale,
    'rows', public.board_line_rows(p_game_id, p_period, p_market, p_outcome, v_books, v_stale, v_admin)
  );
end;
$$;

-- Comparison for a flagged edge — the only place a fair line is ever returned.
create or replace function public.edge_comparison(p_edge_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_e public.edges%rowtype; v_g public.games%rowtype; v_admin boolean := public.is_admin();
  v_stale int; v_books text[]; v_pin public.game_lines%rowtype;
  v_prob numeric; v_fair_price int; v_fair jsonb := null; v_sharp jsonb := null;
  v_sharp_o jsonb;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into v_e from public.edges where id = p_edge_id;
  if not found then return null; end if;
  if v_e.status <> 'active' and not v_admin then return null; end if;

  v_stale := 2 * case when v_e.period = 'FG' then public.engine_cfg_int('poll_interval_minutes', 15)
                      else public.engine_cfg_int('period_refresh_minutes', 120) end;
  v_books := public.engine_cfg_list('active_books') || v_e.local_book;

  if v_e.event_id is null then
    return jsonb_build_object('period', v_e.period, 'market', v_e.market_key, 'outcome', v_e.outcome_name,
                              'point', v_e.point, 'sourceBook', v_e.local_book, 'staleMin', v_stale,
                              'rows', '[]'::jsonb, 'fair', null);
  end if;
  select * into v_g from public.games where id = v_e.event_id;

  select * into v_pin from public.game_lines
    where game_id = v_e.event_id and period = v_e.period and market = v_e.market_key and book = 'Pinnacle';
  if found then
    v_prob := public.engine_outcome_fair(jsonb_build_object('outcomes', v_pin.outcomes), v_e.outcome_name, v_e.point);
    v_fair_price := public.engine_prob_to_american(v_prob);
    if v_fair_price is not null then
      v_fair := jsonb_build_object('price', v_fair_price, 'point', v_e.point,
                                   'updatedAt', v_pin.book_updated_at,
                                   'stale', least(v_pin.book_updated_at, v_pin.fetched_at) < now() - make_interval(mins => v_stale));
    end if;
    if v_admin then
      select o.value into v_sharp_o from jsonb_array_elements(v_pin.outcomes) o
        where o.value->>'name' = v_e.outcome_name limit 1;
      v_sharp := jsonb_build_object('book', 'Pinnacle', 'point', v_sharp_o->'point', 'price', v_sharp_o->'price',
                                    'updatedAt', v_pin.book_updated_at);
    end if;
  end if;
  if v_fair is null then
    -- the sharp line has since dropped off the feed: fall back to the fair
    -- price recorded when the edge was found, flagged stale
    select jsonb_build_object('price', em.sharp_fair_price, 'point', v_e.point,
                              'updatedAt', v_e.created_at, 'stale', true)
      into v_fair from public.edge_method em where em.edge_id = v_e.id and em.sharp_fair_price <> 0;
  end if;

  return jsonb_build_object(
    'edgeId', v_e.id, 'period', v_e.period, 'market', v_e.market_key, 'outcome', v_e.outcome_name,
    'point', v_e.point, 'sourceBook', v_e.local_book, 'sourcePrice', v_e.local_odds,
    'game', case when v_g.id is null then null else jsonb_build_object(
      'id', v_g.id, 'sport', v_g.sport, 'home', v_g.home_team, 'away', v_g.away_team,
      'commence', v_g.commence_time, 'homeScore', v_g.home_score, 'awayScore', v_g.away_score,
      'completed', v_g.completed) end,
    'staleMin', v_stale,
    'rows', public.board_line_rows(v_e.event_id, v_e.period, v_e.market_key, v_e.outcome_name, v_books, v_stale, false),
    'fair', v_fair,
    'sharp', v_sharp
  );
end;
$$;

-- ============================================================
-- PERMISSIONS
-- ============================================================
revoke execute on function public.engine_market_parts(text) from public, anon, authenticated;
revoke execute on function public.engine_api_market(text, text) from public, anon, authenticated;
revoke execute on function public.engine_period_label(text) from public, anon, authenticated;
revoke execute on function public.engine_cfg_int(text, int) from public, anon, authenticated;
revoke execute on function public.engine_cfg_list(text) from public, anon, authenticated;
revoke execute on function public.board_ingest_events(text, text, jsonb, text[]) from public, anon, authenticated;
revoke execute on function public.board_apply_scores(jsonb) from public, anon, authenticated;
revoke execute on function public.engine_scan_events(text, jsonb, boolean, text[]) from public, anon, authenticated;
revoke execute on function public.engine_apply_scores(jsonb) from public, anon, authenticated;
revoke execute on function public.engine_maybe_settle() from public, anon, authenticated;
revoke execute on function public.engine_expire_stale() from public, anon, authenticated;
revoke execute on function public.engine_maybe_poll() from public, anon, authenticated;
revoke execute on function public.engine_maybe_poll_periods() from public, anon, authenticated;
revoke execute on function public.engine_maybe_scores_live() from public, anon, authenticated;
revoke execute on function public.engine_process_pending() from public, anon, authenticated;
revoke execute on function public.engine_tick() from public, anon, authenticated;
revoke execute on function public.board_line_rows(text, text, text, text, text[], int, boolean) from public, anon, authenticated;

revoke execute on function public.board_games(text, text) from public, anon;
revoke execute on function public.market_comparison(text, text, text, text) from public, anon;
revoke execute on function public.edge_comparison(uuid) from public, anon;
grant execute on function public.board_games(text, text) to authenticated;
grant execute on function public.market_comparison(text, text, text, text) to authenticated;
grant execute on function public.edge_comparison(uuid) to authenticated;
