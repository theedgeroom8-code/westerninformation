-- 006: Production hardening.
--   • Server-side input validation on every RPC (client validation is UX,
--     these are the real guarantees).
--   • CHECK constraints on all user-writable columns (NOT VALID so legacy
--     rows never block the migration; enforced for all new writes).
--   • Structured edge identity columns (event/market/outcome/point/source)
--     so the odds engine (007) can dedupe exactly, not by string matching.
--   • "Alerts enabled" feature flag becomes a real kill switch.
--   • Length caps to keep push payloads + UI safe from junk input.

-- ============================================================
-- EDGES — structured identity for the engine + provenance
-- ============================================================
alter table public.edges add column if not exists source text not null default 'manual';
alter table public.edges add column if not exists event_id text;
alter table public.edges add column if not exists market_key text;
alter table public.edges add column if not exists outcome_name text;
alter table public.edges add column if not exists point numeric;

do $$ begin
  alter table public.edges add constraint edges_source_chk check (source in ('manual','engine'));
exception when duplicate_object then null; end $$;

-- Exact-identity dedup lookup for the engine
create index if not exists edges_engine_identity_idx
  on public.edges (event_id, market_key, local_book)
  where status = 'active';

-- ============================================================
-- CHECK CONSTRAINTS (NOT VALID: legacy rows exempt, new writes enforced)
-- ============================================================
do $$ begin
  alter table public.edges add constraint edges_odds_sane_chk
    check (local_odds between -100000 and 100000 and (local_odds >= 100 or local_odds <= -100)) not valid;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.edges add constraint edges_edge_range_chk
    check (edge_pct > 0 and edge_pct <= 50) not valid;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.edges add constraint edges_text_len_chk
    check (char_length(matchup) <= 120 and char_length(specific_bet) <= 80
       and char_length(local_book) <= 40 and char_length(sport) <= 20
       and char_length(league) <= 40 and char_length(bet_type) <= 40) not valid;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.profiles add constraint profiles_name_len_chk
    check (char_length(name) <= 80) not valid;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.profiles add constraint profiles_phone_chk
    check (phone is null or phone = '' or phone ~ '^[0-9+()\s.-]{7,20}$') not valid;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.bets add constraint bets_wager_cap_chk
    check (actual_wager <= 10000000 and recommended_wager >= 0 and recommended_wager <= 10000000) not valid;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.bets add constraint bets_kelly_chk
    check (kelly_fraction between 1 and 100) not valid;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.broadcasts add constraint broadcasts_len_chk
    check (char_length(title) between 1 and 100 and char_length(message) between 1 and 500) not valid;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.user_settings add constraint settings_ranges_chk
    check (kelly_fraction between 1 and 100
       and quiet_start between 0 and 23 and quiet_end between 0 and 23) not valid;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.push_tokens add constraint push_token_format_chk
    check (token ~ '^ExponentPushToken\[[A-Za-z0-9_-]+\]$') not valid;
exception when duplicate_object then null; end $$;

-- ============================================================
-- KILL SWITCH — feature_flags.alerts_enabled now actually gates alerts
-- ============================================================
create or replace function public.edge_alerts_enabled()
returns boolean
language sql stable
set search_path = public
as $$
  select coalesce((value->>'alerts_enabled')::boolean, true)
  from public.app_config where key = 'feature_flags';
$$;

create or replace function public.fanout_edge_alerts()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.edge_alerts_enabled() then return new; end if;
  insert into public.user_alerts (user_id, edge_id)
  select p.id, new.id from public.profiles p where p.is_active
  on conflict do nothing;
  return new;
end;
$$;

-- push_notify_edge gains the same gate (body otherwise identical to 005)
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
  if not public.edge_alerts_enabled() then return new; end if;
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

-- ============================================================
-- RPC INPUT VALIDATION (server-side truth — the client can't bypass these)
-- ============================================================

-- Onboarding bankroll: bounded + one-shot. Later changes go through
-- adjust_bankroll so every movement leaves a history entry.
create or replace function public.set_starting_bankroll(p_amount numeric)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v_prev numeric; v_start numeric;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be positive'; end if;
  if p_amount > 100000000 then raise exception 'Amount is too large'; end if;
  select balance, starting_balance into v_prev, v_start
    from public.bankrolls where user_id = auth.uid() for update;
  if not found then raise exception 'Account not ready yet'; end if;
  if coalesce(v_start, 0) > 0 then raise exception 'Bankroll already set'; end if;
  update public.bankrolls
    set balance = p_amount, starting_balance = p_amount, updated_at = now()
    where user_id = auth.uid();
  insert into public.bankroll_history (user_id, amount, previous_amount, change_amount, reason)
  values (auth.uid(), p_amount, coalesce(v_prev,0), p_amount - coalesce(v_prev,0), 'Starting bankroll');
end;
$$;

create or replace function public.adjust_bankroll(p_change numeric, p_reason text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v_prev numeric; v_new numeric;
begin
  if p_change is null or p_change = 0 then raise exception 'Amount must not be zero'; end if;
  if abs(p_change) > 100000000 then raise exception 'Amount is too large'; end if;
  select balance into v_prev from public.bankrolls where user_id = auth.uid() for update;
  if not found then raise exception 'Account not ready yet'; end if;
  v_new := coalesce(v_prev,0) + p_change;
  if v_new < 0 then raise exception 'Insufficient bankroll'; end if;
  update public.bankrolls set balance = v_new, updated_at = now() where user_id = auth.uid();
  insert into public.bankroll_history (user_id, amount, previous_amount, change_amount, reason)
  values (auth.uid(), v_new, coalesce(v_prev,0), p_change,
          left(coalesce(nullif(trim(p_reason),''), 'Manual adjustment'), 120));
end;
$$;

-- Log a bet: edge must still be live, wager bounded by the live bankroll —
-- the tracked book can't drift from what a real bettor could actually stake.
create or replace function public.log_bet(
  p_edge_id uuid,
  p_actual_wager numeric,
  p_recommended_wager numeric default 0,
  p_kelly_fraction int default 25
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare v_edge public.edges%rowtype; v_id uuid; v_balance numeric;
begin
  if p_actual_wager is null or p_actual_wager <= 0 then raise exception 'Wager must be positive'; end if;
  if p_actual_wager > 10000000 then raise exception 'Amount is too large'; end if;
  if p_kelly_fraction not between 1 and 100 then raise exception 'Invalid risk level'; end if;
  select * into v_edge from public.edges where id = p_edge_id;
  if not found then raise exception 'Edge not found'; end if;
  if v_edge.status <> 'active' then raise exception 'Edge no longer active'; end if;
  select balance into v_balance from public.bankrolls where user_id = auth.uid();
  if p_actual_wager > coalesce(v_balance, 0) then raise exception 'Wager exceeds your bankroll'; end if;
  insert into public.bets (
    user_id, edge_id, sport, matchup, bet_type, specific_bet,
    local_book, local_odds, edge_pct, kelly_fraction, recommended_wager, actual_wager
  ) values (
    auth.uid(), v_edge.id, v_edge.sport, v_edge.matchup, v_edge.bet_type, v_edge.specific_bet,
    v_edge.local_book, v_edge.local_odds, v_edge.edge_pct, p_kelly_fraction,
    greatest(0, least(coalesce(p_recommended_wager, 0), 10000000)), p_actual_wager
  ) returning id into v_id;
  return v_id;
end;
$$;

-- New-user trigger: cap metadata lengths (defense against oversized JWT metadata)
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, email, phone)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data->>'name', ''), 80),
    left(coalesce(new.email, ''), 255),
    nullif(left(coalesce(new.raw_user_meta_data->>'phone', ''), 20), '')
  ) on conflict (id) do nothing;
  insert into public.user_settings (user_id) values (new.id) on conflict do nothing;
  insert into public.bankrolls (user_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

-- Internal helpers are not client API — remove default execute grants
revoke execute on function public.send_expo_push(jsonb) from public, anon, authenticated;
revoke execute on function public.edge_alerts_enabled() from public, anon;
