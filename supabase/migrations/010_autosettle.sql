-- 010: AUTOMATIC BET SETTLEMENT from live final scores.
--
-- Every hour (only while unsettled bets exist), the engine pulls final
-- scores for the sports involved and settles each bet:
--   Moneyline: higher score wins · tie = push
--   Spread:    team score + line vs opponent · exact = push
--   Total:     combined score vs the line · exact = push
-- push = tie against the line → stake returned, $0 profit/loss.
--
-- Settlement runs the same immutable money math as manual settling and
-- notifies the bettor by push ("✅ Bet Won +$63"). Only bets logged against
-- engine-detected edges carry the structured event identity needed to
-- auto-settle; bets on manually published edges still settle by hand.

alter table public.engine_requests add column if not exists req_type text not null default 'odds';
alter table public.engine_state add column if not exists last_scores_poll_at timestamptz;

-- ---------- settle one bet for its owner (engine context, no auth.uid) ----------
create or replace function public.engine_settle_bet(p_bet_id uuid, p_result text)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare
  v_bet public.bets%rowtype; v_pl numeric; v_prev numeric; v_messages jsonb;
begin
  if p_result not in ('win','loss','push') then return false; end if;
  select * into v_bet from public.bets where id = p_bet_id for update;
  if not found or v_bet.result is not null then return false; end if;

  v_pl := case p_result
    when 'push' then 0
    when 'loss' then -v_bet.actual_wager
    when 'win' then round(
      case when v_bet.local_odds > 0
        then v_bet.actual_wager * v_bet.local_odds / 100.0
        else v_bet.actual_wager * 100.0 / abs(v_bet.local_odds)
      end, 2)
  end;

  update public.bets
    set result = p_result, profit_loss = v_pl, date_resulted = now()
    where id = p_bet_id;

  if v_pl <> 0 then
    select balance into v_prev from public.bankrolls where user_id = v_bet.user_id for update;
    update public.bankrolls set balance = coalesce(v_prev,0) + v_pl, updated_at = now()
      where user_id = v_bet.user_id;
    insert into public.bankroll_history (user_id, amount, previous_amount, change_amount, reason)
    values (v_bet.user_id, coalesce(v_prev,0) + v_pl, coalesce(v_prev,0), v_pl,
      'Bet ' || p_result || ' (auto-settled) · ' || v_bet.sport || ' ' || v_bet.specific_bet);
  end if;

  -- notify the owner (respects push toggle + quiet hours)
  select jsonb_agg(jsonb_build_object(
    'to', pt.token,
    'title', case p_result
      when 'win' then '✅ Bet Won · +$' || to_char(v_pl, 'FM999999990')
      when 'loss' then '❌ Bet Lost · -$' || to_char(abs(v_pl), 'FM999999990')
      else '↩️ Push — stake returned' end,
    'body', v_bet.matchup || E'\n' || v_bet.specific_bet || ' @ ' || v_bet.local_book,
    'sound', 'default',
    'channelId', 'edges',
    'data', jsonb_build_object('type', 'bet-result')
  ))
  into v_messages
  from public.push_tokens pt
  join public.profiles p on p.id = pt.user_id and p.is_active
  join public.user_settings s on s.user_id = pt.user_id
  where pt.user_id = v_bet.user_id
    and s.push_alerts
    and not public.in_quiet_hours(s);

  if v_messages is not null then
    perform public.send_expo_push(v_messages);
  end if;
  return true;
end;
$$;

-- ---------- grade every unsettled bet against a scores payload ----------
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
      where b.result is null and e.event_id = v_ev->>'id'
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

-- ---------- request final scores when settleable bets are waiting ----------
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

  -- only spend credits when a bet is actually waiting on a finished game
  if not exists (
    select 1 from public.bets b
    join public.edges e on e.id = b.edge_id
    where b.result is null and e.event_id is not null
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
      where b.result is null and e.event_id is not null
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

-- ---------- process: branch odds-scan vs scores-settle ----------
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
    if jsonb_typeof(v_body) <> 'array' then
      insert into public.engine_runs (kind, sport, detail)
      values ('error', v_r.sport, 'Unexpected API response shape');
      continue;
    end if;

    v_n := jsonb_array_length(v_body);

    if v_r.req_type = 'scores' then
      v_created := public.engine_apply_scores(v_body);
      insert into public.engine_runs (kind, sport, events, edges_created, credits_remaining, detail)
      values ('settle', v_r.sport, v_n, v_created, v_credits,
              v_created || ' bet(s) auto-settled from final scores');
    else
      insert into public.engine_sport_state (sport, last_polled_at, last_events)
      values (v_r.api_sport, now(), v_n)
      on conflict (sport) do update set last_events = excluded.last_events;

      v_created := public.engine_scan_events(v_r.sport, v_body);

      insert into public.engine_runs (kind, sport, events, edges_created, credits_remaining, detail)
      values ('scan', v_r.sport, v_n, v_created, v_credits,
              v_n || ' game(s) scanned · ' || v_created || ' new edge(s)');
    end if;
  end loop;

  delete from public.engine_requests where processed and fired_at < now() - interval '1 day';
  delete from public.engine_runs where at < now() - interval '14 days';
end;
$$;

-- ---------- tick gains the settlement step ----------
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
    perform public.engine_maybe_settle();
  exception when others then
    begin
      insert into public.engine_runs (kind, detail) values ('error', left(sqlerrm, 300));
    exception when others then null; end;
  end;
  perform pg_advisory_unlock(982451);
end;
$$;

revoke execute on function public.engine_settle_bet(uuid, text) from public, anon, authenticated;
revoke execute on function public.engine_apply_scores(jsonb) from public, anon, authenticated;
revoke execute on function public.engine_maybe_settle() from public, anon, authenticated;
revoke execute on function public.engine_process_pending() from public, anon, authenticated;
revoke execute on function public.engine_tick() from public, anon, authenticated;
