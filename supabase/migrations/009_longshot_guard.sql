-- 009: Longshot-bias guard.
-- Proportional no-vig overstates fair probabilities for big underdogs
-- (favorite-longshot bias), which manufactures fake 15%+ "edges" on +1200
-- moneylines. Real betting value in this product lives near even money —
-- exactly like the brief's examples (-100 to -115). Detection is therefore
-- limited to prices in the -350..+350 band on BOTH sides of the comparison.

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
  v_band numeric := coalesce((public.engine_cfg('max_abs_odds') #>> '{}')::numeric, 350);
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

    -- ---- (A) verify EXISTING engine edges: refresh, expire, or band-evict ----
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

      -- longshot guard: BOTH sharp sides must sit inside the price band, or
      -- the no-vig fair numbers aren't trustworthy for this market
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
        v_lm := public.engine_find_market(v_rec.book, v_mkey);
        if v_lm is null then continue; end if;

        for v_lo in select value from jsonb_array_elements(coalesce(v_lm->'outcomes','[]'::jsonb)) loop
          v_name := v_lo->>'name';
          v_point := (v_lo->>'point')::numeric;
          v_price := (v_lo->>'price')::numeric;
          if v_name is null or v_price is null then continue; end if;
          if abs(v_price) < 100 or abs(v_price) > v_band then continue; end if;

          v_fair := public.engine_outcome_fair(v_pm, v_name, v_point);
          if v_fair is null then continue; end if;

          v_dec := case when v_price > 0 then 1 + v_price/100 else 1 + 100/abs(v_price) end;
          v_edge := (v_fair * v_dec - 1) * 100;
          if v_edge < v_threshold then continue; end if;
          if v_edge > 20 then continue; end if;

          if exists (select 1 from public.edges
                     where event_id = v_event_id and market_key = v_mkey
                       and outcome_name = v_name and point is not distinct from v_point
                       and local_book = v_rec.display_name and status = 'active') then
            continue;
          end if;
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

  for v_c in
    select value from jsonb_array_elements(v_cands)
    order by (value->>'edge')::numeric desc
  loop
    exit when v_created >= v_max;
    v_event_id := v_c->>'event_id';
    v_mkey := v_c->>'market';
    v_name := v_c->>'name';
    v_point := (v_c->>'point')::numeric;

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

revoke execute on function public.engine_scan_events(text, jsonb) from public, anon, authenticated;

insert into public.app_config (key, value) values ('max_abs_odds', '350'::jsonb)
on conflict (key) do nothing;

-- Evict the longshot artifacts already published under the old rule
update public.edges
  set status = 'expired'
  where source = 'engine' and status = 'active' and abs(local_odds) > 350;
