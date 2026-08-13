-- 008: Client requests (Aug 2026) + engine feed expansion.
--   • Nevada rotation numbers on edges (manual admin entry — no official API
--     carries them). Shown in alerts as "#457" so Vegas bettors can quote
--     the number at the window.
--   • WNBA is back (client message 07/08) + NFL pre-season feed.
--   • api_sport_map reworked: one display sport can now have several API
--     feeds (NFL = regular + preseason), keyed by api_key.

-- ============================================================
-- ROTATION NUMBER
-- ============================================================
alter table public.edges add column if not exists rotation_number int;
do $$ begin
  alter table public.edges add constraint edges_rotation_chk
    check (rotation_number is null or rotation_number between 1 and 99999) not valid;
exception when duplicate_object then null; end $$;

-- Push alert body gains the rotation prefix when present
create or replace function public.push_notify_edge()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_messages jsonb;
  v_is_high boolean := new.edge_pct >= 4;
  v_rot text := case when new.rotation_number is not null then '#' || new.rotation_number || ' · ' else '' end;
  v_dec numeric := case when new.local_odds > 0
                        then 1 + new.local_odds / 100.0
                        else 1 + 100.0 / abs(new.local_odds) end;
begin
  if not public.edge_alerts_enabled() then return new; end if;
  select jsonb_agg(jsonb_build_object(
    'to', pt.token,
    'title', '⚡ ' || to_char(new.edge_pct, 'FM990.0') || '% Edge — ' || new.sport,
    'body', new.matchup || E'\n' || v_rot || new.specific_bet || ' @ ' || new.local_book
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

-- ============================================================
-- SPORT FEEDS — api_key is now the primary key (NFL has two feeds)
-- ============================================================
drop table if exists public.api_sport_map;
create table public.api_sport_map (
  api_key text primary key,
  sport text not null
);
insert into public.api_sport_map (api_key, sport) values
  ('americanfootball_nfl',           'NFL'),
  ('americanfootball_nfl_preseason', 'NFL'),
  ('americanfootball_ncaaf',         'NCAAF'),
  ('basketball_nba',                 'NBA'),
  ('basketball_wnba',                'WNBA'),
  ('basketball_ncaab',               'NCAAB'),
  ('baseball_mlb',                   'MLB'),
  ('icehockey_nhl',                  'NHL');

alter table public.api_sport_map enable row level security;
drop policy if exists "api_sport_map_admin" on public.api_sport_map;
create policy "api_sport_map_admin" on public.api_sport_map for select using (public.is_admin());

-- engine_sport_state now keys by API feed, not display sport (regular and
-- pre-season NFL are in season at different times)
delete from public.engine_sport_state;

-- WNBA joins the monitored list
update public.app_config
  set value = value || '["WNBA"]'::jsonb, updated_at = now()
  where key = 'active_sports' and not value ? 'WNBA';

-- ============================================================
-- ENGINE FN UPDATES — poll every feed of every active sport
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
    -- feeds with no events (off-season) re-polled at most every 6h
    select * into v_ss from public.engine_sport_state where sport = v_s.api_key;
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
    values (v_s.api_key, now())
    on conflict (sport) do update set last_polled_at = now();
    v_fired := v_fired + 1;
  end loop;

  update public.engine_state
    set last_poll_at = now(), last_status = 'running', paused_reason = null, updated_at = now()
    where id = 1;
  if v_fired > 0 then
    insert into public.engine_runs (kind, detail)
    values ('poll', 'Polled ' || v_fired || ' feed(s) [regions: ' || v_regions || ']');
  end if;
end;
$$;

-- process: track per-feed event counts (v_r.api_sport, not display sport)
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
    insert into public.engine_sport_state (sport, last_polled_at, last_events)
    values (v_r.api_sport, now(), v_n)
    on conflict (sport) do update set last_events = excluded.last_events;

    v_created := public.engine_scan_events(v_r.sport, v_body);

    insert into public.engine_runs (kind, sport, events, edges_created, credits_remaining, detail)
    values ('scan', v_r.sport, v_n, v_created, v_credits,
            v_n || ' game(s) scanned · ' || v_created || ' new edge(s)');
  end loop;

  delete from public.engine_requests where processed and fired_at < now() - interval '1 day';
  delete from public.engine_runs where at < now() - interval '14 days';
end;
$$;

revoke execute on function public.engine_maybe_poll() from public, anon, authenticated;
revoke execute on function public.engine_process_pending() from public, anon, authenticated;
