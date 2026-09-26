-- 017: Client feedback on the Sep 26 board spec (relayed verbatim + screenshot
-- of an old rotation-number text alert):
--   • Alert text should be compact: game code, edge, team/play, book, amount,
--     kickoff — not a description of the whole market.
--   • No live in-game score polling needed.
--   • Final score + win/loss should live on a page everyone can see — not as
--     a text/push.
--
-- This migration:
--   1. Auto-assigns a stable "#101/#102"-style code pair to every board game
--      (away = odd, home = even), so engine-created edges get a rotation
--      number without an admin typing one in (rotation_number already existed
--      — see 008_rotation_wnba.sql — but only manual admin edges used it).
--   2. Reshapes the edge-alert push body into one compact line with the code,
--      the play, the price, the edge %, the play amount, the book, and the
--      ET kickoff.
--   3. Turns off live in-game score polling (engine_maybe_scores_live already
--      had an "Off" setting at 0 — this just uses it).
--   4. Grades every engine full-game edge (win/loss/push + final score) as
--      soon as its game completes, whether or not anyone logged a bet on it,
--      so a public track record is possible. Broadens the final-score poll
--      so it isn't gated on a pending bet existing.
--   5. Widens spend on the (now cheaper) final-score poll to cover any board
--      game, not only ones with a bet riding on them.

-- ============================================================
-- GAME CODES — stable "#101/#102" pair per game (away=odd, home=even)
-- ============================================================
alter table public.games add column if not exists away_code int;
alter table public.games add column if not exists home_code int;

alter table public.engine_state add column if not exists code_day date;
alter table public.engine_state add column if not exists next_game_code int not null default 101;

-- Resets to 101 at the start of each Eastern day; otherwise +2 per game.
-- Returns the AWAY code — home is always away+1.
create or replace function public.engine_next_game_code()
returns int
language plpgsql security definer
set search_path = public
as $$
declare v_day date := (now() at time zone 'America/New_York')::date; v_code int;
begin
  update public.engine_state e set
    next_game_code = (case when e.code_day = v_day then e.next_game_code else 101 end) + 2,
    code_day = v_day
  where id = 1
  returning next_game_code - 2 into v_code;
  return coalesce(v_code, 101);
end;
$$;

-- ============================================================
-- INGEST — assign a code pair the first time a game is seen
-- ============================================================
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
  v_n int := 0; v_code int;
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

    if (select g.away_code from public.games g where g.id = v_id) is null then
      v_code := public.engine_next_game_code();
      update public.games set away_code = v_code, home_code = v_code + 1 where id = v_id;
    end if;

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

-- ============================================================
-- EDGE SCAN — carry the game's rotation code onto each new edge
-- ============================================================
-- Totals convention (per client): Over cites the away code, Under the home
-- code. h2h/spreads cite whichever side the play is on.
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
  v_acode int; v_hcode int;
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
    select g.away_code, g.home_code into v_acode, v_hcode from public.games g where g.id = v_event_id;

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
              'book', v_rec.display_name, 'pinn_price', (v_pinn_o->>'price')::numeric,
              'rotation', case
                when v_mkey = 'totals' then (case when v_name = 'Over' then v_acode else v_hcode end)
                when v_name = v_home then v_hcode
                when v_name = v_away then v_acode
                else null
              end));
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
      edge_pct, game_time, alert_time, source, event_id, market_key, outcome_name, point, period,
      rotation_number
    ) values (
      p_sport, p_sport, v_c->>'matchup', v_bt, v_sb, v_c->>'book',
      round((v_c->>'price')::numeric)::int, round((v_c->>'edge')::numeric, 2),
      (v_c->>'commence')::timestamptz, now(), 'engine',
      v_event_id, v_mkey, v_name, v_point, v_period,
      (v_c->>'rotation')::int
    ) returning id into v_eid;

    insert into public.edge_method (edge_id, sharp_fair_price, no_vig_prob, book_lines, notes)
    values (
      v_eid, (v_c->>'pinn_price')::numeric,
      case when (v_c->>'pinn_price')::numeric > 0
           then 100.0 / ((v_c->>'pinn_price')::numeric + 100)
           else abs((v_c->>'pinn_price')::numeric) / (abs((v_c->>'pinn_price')::numeric) + 100) end,
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
-- COMPACT ALERT TEXT — code, play, price, edge%, amount, book, ET kickoff
-- ============================================================
create or replace function public.push_notify_edge()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_messages jsonb;
  v_is_high boolean := new.edge_pct >= 4;
  v_rot text := case when new.rotation_number is not null then '#' || new.rotation_number || ' ' else '' end;
  v_dec numeric := case when new.local_odds > 0
                        then 1 + new.local_odds / 100.0
                        else 1 + 100.0 / abs(new.local_odds) end;
  v_when text := to_char(new.game_time at time zone 'America/New_York', 'Dy, Mon FMDD FMHH12:MI AM') || ' ET';
begin
  if not public.edge_alerts_enabled() then return new; end if;
  select jsonb_agg(jsonb_build_object(
    'to', pt.token,
    'title', '⚡ ' || to_char(new.edge_pct, 'FM990.0') || '% Edge — ' || new.sport,
    'body', v_rot || new.specific_bet
            || ' (' || (case when new.local_odds > 0 then '+' else '' end) || new.local_odds || ')'
            || ' · ' || to_char(new.edge_pct, 'FM990.0') || '% edge'
            || ' · Play $' || greatest(0, round(
                 coalesce(b.balance, 0) * (new.edge_pct / 100.0) * v_dec / (v_dec - 1)
                 * (s.kelly_fraction / 100.0)))::text
            || ' · ' || new.local_book
            || ' · ' || v_when,
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

-- ============================================================
-- NO LIVE SCORE POLLING — client doesn't want it; final score still comes
-- from the (cheap, batched) settlement poll below.
-- ============================================================
update public.app_config set value = '0'::jsonb where key = 'live_score_refresh_minutes';

-- ============================================================
-- PUBLIC TRACK RECORD — grade every engine edge, not just bet-backed ones
-- ============================================================
alter table public.edges add column if not exists result text;
do $$ begin
  alter table public.edges add constraint edges_result_chk check (result in ('win','loss','push'));
exception when duplicate_object then null; end $$;
alter table public.edges add column if not exists final_away_score int;
alter table public.edges add column if not exists final_home_score int;

-- Shared grading rule (moneyline / spread / total) — used for both a user's
-- bet and the edge's own public result, so the two can never disagree.
create or replace function public.engine_grade_outcome(
  p_market_key text, p_outcome_name text, p_point numeric,
  p_home text, p_away text, p_home_score numeric, p_away_score numeric
)
returns text
language sql immutable
as $$
  select case
    when p_market_key = 'h2h' then
      case when p_home_score = p_away_score then 'push'
           when (p_home_score > p_away_score and p_outcome_name = p_home)
             or (p_away_score > p_home_score and p_outcome_name = p_away) then 'win'
           when p_outcome_name in (p_home, p_away) then 'loss'
      end
    when p_market_key = 'spreads' and p_point is not null then
      case
        when (p_outcome_name = p_home and p_home_score + p_point > p_away_score)
          or (p_outcome_name = p_away and p_away_score + p_point > p_home_score) then 'win'
        when (p_outcome_name = p_home and p_home_score + p_point = p_away_score)
          or (p_outcome_name = p_away and p_away_score + p_point = p_home_score) then 'push'
        when p_outcome_name in (p_home, p_away) then 'loss'
      end
    when p_market_key = 'totals' and p_point is not null then
      case
        when p_home_score + p_away_score = p_point then 'push'
        when (p_outcome_name = 'Over' and p_home_score + p_away_score > p_point)
          or (p_outcome_name = 'Under' and p_home_score + p_away_score < p_point) then 'win'
        when p_outcome_name in ('Over','Under') then 'loss'
      end
  end;
$$;

create or replace function public.engine_apply_scores(p_events jsonb)
returns int
language plpgsql security definer
set search_path = public
as $$
declare
  v_ev jsonb; v_home text; v_away text; v_hs numeric; v_as numeric;
  v_bet record; v_edge record; v_res text; v_settled int := 0;
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

    -- grade every engine edge for this game, bet or no bet — this is the feed
    -- for the public "recent results" list, independent of bet settlement.
    for v_edge in
      select id, market_key, outcome_name, point
      from public.edges
      where result is null and event_id = v_ev->>'id' and period = 'FG' and source = 'engine'
    loop
      v_res := public.engine_grade_outcome(v_edge.market_key, v_edge.outcome_name, v_edge.point, v_home, v_away, v_hs, v_as);
      if v_res is not null then
        update public.edges
          set result = v_res, final_home_score = v_hs, final_away_score = v_as
          where id = v_edge.id;
      end if;
    end loop;

    for v_bet in
      select b.id as bet_id, e.market_key, e.outcome_name, e.point
      from public.bets b
      join public.edges e on e.id = b.edge_id
      where b.result is null and e.event_id = v_ev->>'id' and e.period = 'FG'
    loop
      v_res := public.engine_grade_outcome(v_bet.market_key, v_bet.outcome_name, v_bet.point, v_home, v_away, v_hs, v_as);
      if v_res is not null and public.engine_settle_bet(v_bet.bet_id, v_res) then
        v_settled := v_settled + 1;
      end if;
    end loop;
  end loop;
  return v_settled;
end;
$$;

-- Final-score poll no longer waits on a pending bet — it also fires once a
-- board game should be over, so the public results list fills in even when
-- nobody logged a bet. Still one batched call per sport (2 credits), at most
-- once an hour.
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
  ) and not exists (
    select 1 from public.games g
    where g.sport = any(public.engine_cfg_list('board_sports'))
      and g.commence_time < now() - interval '3 hours'
      and g.commence_time > now() - interval '2 days'
      and not g.completed
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
      union
      select distinct g.sport
      from public.games g
      where g.sport = any(public.engine_cfg_list('board_sports'))
        and g.commence_time < now() - interval '3 hours'
        and g.commence_time > now() - interval '2 days'
        and not g.completed
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

revoke execute on function public.engine_next_game_code() from public, anon, authenticated;
revoke execute on function public.engine_grade_outcome(text, text, numeric, text, text, numeric, numeric) from public, anon, authenticated;
