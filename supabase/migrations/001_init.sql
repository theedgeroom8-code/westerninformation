-- ============================================================
-- Sports Betting Edge System — initial schema
-- Tables, RLS, triggers, RPCs, realtime, seed config.
-- Idempotent where practical (drop-if-exists on functions/triggers).
-- ============================================================

create extension if not exists pgcrypto;

-- ============================================================
-- TABLES
-- ============================================================

-- Profiles (mirror of auth.users + app fields)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  email text not null default '',
  phone text,
  role text not null default 'user' check (role in ('user','admin')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Per-user preferences (user-editable)
create table if not exists public.user_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  kelly_fraction int not null default 25,
  sms_alerts boolean not null default true,
  high_edge_alerts boolean not null default true,
  quiet_hours_enabled boolean not null default false,
  quiet_start int not null default 23,
  quiet_end int not null default 8,
  biometric_unlock boolean not null default false,
  preferred_sports text[] not null default '{NFL,NBA,MLB,NHL}',
  updated_at timestamptz not null default now()
);

-- Live bankroll (tracking only — no real money)
create table if not exists public.bankrolls (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  balance numeric(12,2) not null default 0,
  starting_balance numeric(12,2) not null default 0,
  updated_at timestamptz not null default now()
);

-- Every bankroll change, with reason + timestamp (brief §7.2)
create table if not exists public.bankroll_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric(12,2) not null,
  previous_amount numeric(12,2) not null,
  change_amount numeric(12,2) not null,
  reason text not null,
  created_at timestamptz not null default now()
);
create index if not exists bankroll_history_user_idx on public.bankroll_history(user_id, created_at desc);

-- Edges — USER-VISIBLE fields only. No fair price / sharp data here.
create table if not exists public.edges (
  id uuid primary key default gen_random_uuid(),
  sport text not null,
  league text not null default '',
  matchup text not null,
  bet_type text not null,
  specific_bet text not null,
  local_book text not null,
  local_odds int not null,
  edge_pct numeric(5,2) not null,
  status text not null default 'active' check (status in ('active','expired')),
  game_time timestamptz not null,
  alert_time timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists edges_status_idx on public.edges(status, edge_pct desc);

-- THE METHOD — admin-only. Sharp fair price, no-vig, per-book lines.
-- RLS below denies users entirely; this never reaches the app for non-admins.
create table if not exists public.edge_method (
  edge_id uuid primary key references public.edges(id) on delete cascade,
  sharp_fair_price int not null,
  no_vig_prob numeric(7,5),
  book_lines jsonb not null default '[]'::jsonb,
  notes text,
  updated_at timestamptz not null default now()
);

-- Logged bets. Edge data is SNAPSHOTTED so history survives edge expiry.
create table if not exists public.bets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  edge_id uuid references public.edges(id) on delete set null,
  sport text not null,
  matchup text not null,
  bet_type text not null,
  specific_bet text not null,
  local_book text not null,
  local_odds int not null,
  edge_pct numeric(5,2) not null,
  kelly_fraction int not null default 25,
  recommended_wager numeric(12,2) not null default 0,
  actual_wager numeric(12,2) not null check (actual_wager > 0),
  result text check (result in ('win','loss','push')),
  profit_loss numeric(12,2),
  date_logged timestamptz not null default now(),
  date_resulted timestamptz
);
create index if not exists bets_user_idx on public.bets(user_id, date_logged desc);

-- Per-user alert inbox (fanned out on edge insert)
create table if not exists public.user_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  edge_id uuid not null references public.edges(id) on delete cascade,
  read boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, edge_id)
);
create index if not exists user_alerts_user_idx on public.user_alerts(user_id, created_at desc);

-- Admin → all users announcements
create table if not exists public.broadcasts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  message text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Engine config + feature flags (admin-managed)
create table if not exists public.app_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------- helper: is_admin (after profiles exists) ----------
create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and is_active
  );
$$;

-- ============================================================
-- TRIGGERS
-- ============================================================

-- New auth user → profile + settings + bankroll
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, email, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', ''),
    coalesce(new.email, ''),
    new.raw_user_meta_data->>'phone'
  ) on conflict (id) do nothing;
  insert into public.user_settings (user_id) values (new.id) on conflict do nothing;
  insert into public.bankrolls (user_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Non-admins cannot change role / is_active on their own profile
create or replace function public.protect_profile_fields()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    new.role := old.role;
    new.is_active := old.is_active;
  end if;
  return new;
end;
$$;
drop trigger if exists protect_profile_fields on public.profiles;
create trigger protect_profile_fields
  before update on public.profiles
  for each row execute function public.protect_profile_fields();

-- New edge → fan out an alert to every active user (realtime "push")
create or replace function public.fanout_edge_alerts()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.user_alerts (user_id, edge_id)
  select p.id, new.id from public.profiles p where p.is_active
  on conflict do nothing;
  return new;
end;
$$;
drop trigger if exists fanout_edge_alerts on public.edges;
create trigger fanout_edge_alerts
  after insert on public.edges
  for each row execute function public.fanout_edge_alerts();

-- ============================================================
-- RPCs (atomic, security definer — the only write path for money math)
-- ============================================================

-- Onboarding: set starting bankroll
create or replace function public.set_starting_bankroll(p_amount numeric)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v_prev numeric;
begin
  if p_amount <= 0 then raise exception 'Amount must be positive'; end if;
  select balance into v_prev from public.bankrolls where user_id = auth.uid() for update;
  update public.bankrolls
    set balance = p_amount, starting_balance = p_amount, updated_at = now()
    where user_id = auth.uid();
  insert into public.bankroll_history (user_id, amount, previous_amount, change_amount, reason)
  values (auth.uid(), p_amount, coalesce(v_prev,0), p_amount - coalesce(v_prev,0), 'Starting bankroll');
end;
$$;

-- Manual deposit / withdrawal (bookkeeping only)
create or replace function public.adjust_bankroll(p_change numeric, p_reason text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v_prev numeric; v_new numeric;
begin
  select balance into v_prev from public.bankrolls where user_id = auth.uid() for update;
  v_new := coalesce(v_prev,0) + p_change;
  if v_new < 0 then raise exception 'Insufficient bankroll'; end if;
  update public.bankrolls set balance = v_new, updated_at = now() where user_id = auth.uid();
  insert into public.bankroll_history (user_id, amount, previous_amount, change_amount, reason)
  values (auth.uid(), v_new, coalesce(v_prev,0), p_change, coalesce(nullif(trim(p_reason),''), 'Manual adjustment'));
end;
$$;

-- Log a bet against an edge (snapshots edge fields server-side)
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
declare v_edge public.edges%rowtype; v_id uuid;
begin
  if p_actual_wager <= 0 then raise exception 'Wager must be positive'; end if;
  select * into v_edge from public.edges where id = p_edge_id;
  if not found then raise exception 'Edge not found'; end if;
  insert into public.bets (
    user_id, edge_id, sport, matchup, bet_type, specific_bet,
    local_book, local_odds, edge_pct, kelly_fraction, recommended_wager, actual_wager
  ) values (
    auth.uid(), v_edge.id, v_edge.sport, v_edge.matchup, v_edge.bet_type, v_edge.specific_bet,
    v_edge.local_book, v_edge.local_odds, v_edge.edge_pct, p_kelly_fraction, p_recommended_wager, p_actual_wager
  ) returning id into v_id;
  return v_id;
end;
$$;

-- Settle a bet: odds-based P&L, bankroll update, history entry.
-- One-shot: a settled bet can never be changed (client requirement 6.2).
create or replace function public.settle_bet(p_bet_id uuid, p_result text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v_bet public.bets%rowtype; v_pl numeric; v_prev numeric;
begin
  if p_result not in ('win','loss','push') then raise exception 'Invalid result'; end if;
  select * into v_bet from public.bets where id = p_bet_id and user_id = auth.uid() for update;
  if not found then raise exception 'Bet not found'; end if;
  if v_bet.result is not null then raise exception 'Bet already settled'; end if;

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
    select balance into v_prev from public.bankrolls where user_id = auth.uid() for update;
    update public.bankrolls set balance = coalesce(v_prev,0) + v_pl, updated_at = now()
      where user_id = auth.uid();
    insert into public.bankroll_history (user_id, amount, previous_amount, change_amount, reason)
    values (auth.uid(), coalesce(v_prev,0) + v_pl, coalesce(v_prev,0), v_pl,
      'Bet ' || p_result || ' · ' || v_bet.sport || ' ' || v_bet.specific_bet);
  end if;
end;
$$;

grant execute on function public.set_starting_bankroll(numeric) to authenticated;
grant execute on function public.adjust_bankroll(numeric, text) to authenticated;
grant execute on function public.log_bet(uuid, numeric, numeric, int) to authenticated;
grant execute on function public.settle_bet(uuid, text) to authenticated;
grant execute on function public.is_admin() to authenticated;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.bankrolls enable row level security;
alter table public.bankroll_history enable row level security;
alter table public.edges enable row level security;
alter table public.edge_method enable row level security;
alter table public.bets enable row level security;
alter table public.user_alerts enable row level security;
alter table public.broadcasts enable row level security;
alter table public.app_config enable row level security;

-- profiles
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles for select
  using (id = auth.uid() or public.is_admin());
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update
  using (id = auth.uid() or public.is_admin());

-- user_settings
drop policy if exists "settings_own" on public.user_settings;
create policy "settings_own" on public.user_settings for all
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

-- bankrolls (writes only through RPCs)
drop policy if exists "bankrolls_select" on public.bankrolls;
create policy "bankrolls_select" on public.bankrolls for select
  using (user_id = auth.uid() or public.is_admin());

-- bankroll_history (writes only through RPCs)
drop policy if exists "history_select" on public.bankroll_history;
create policy "history_select" on public.bankroll_history for select
  using (user_id = auth.uid() or public.is_admin());

-- edges: everyone signed-in can read; only admins write
drop policy if exists "edges_select" on public.edges;
create policy "edges_select" on public.edges for select
  using (auth.uid() is not null);
drop policy if exists "edges_admin_write" on public.edges;
create policy "edges_admin_write" on public.edges for insert
  with check (public.is_admin());
drop policy if exists "edges_admin_update" on public.edges;
create policy "edges_admin_update" on public.edges for update
  using (public.is_admin());
drop policy if exists "edges_admin_delete" on public.edges;
create policy "edges_admin_delete" on public.edges for delete
  using (public.is_admin());

-- edge_method: ADMIN ONLY — users can never read the method
drop policy if exists "method_admin_only" on public.edge_method;
create policy "method_admin_only" on public.edge_method for all
  using (public.is_admin())
  with check (public.is_admin());

-- bets: own rows readable; inserts/settles via RPC; admin reads all
drop policy if exists "bets_select" on public.bets;
create policy "bets_select" on public.bets for select
  using (user_id = auth.uid() or public.is_admin());

-- user_alerts: own inbox; user may flip read flag
drop policy if exists "alerts_select" on public.user_alerts;
create policy "alerts_select" on public.user_alerts for select
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists "alerts_update" on public.user_alerts;
create policy "alerts_update" on public.user_alerts for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- broadcasts: all signed-in read; admin writes
drop policy if exists "broadcasts_select" on public.broadcasts;
create policy "broadcasts_select" on public.broadcasts for select
  using (auth.uid() is not null);
drop policy if exists "broadcasts_admin_insert" on public.broadcasts;
create policy "broadcasts_admin_insert" on public.broadcasts for insert
  with check (public.is_admin());
drop policy if exists "broadcasts_admin_delete" on public.broadcasts;
create policy "broadcasts_admin_delete" on public.broadcasts for delete
  using (public.is_admin());

-- app_config: admins full; users may read feature_flags only
drop policy if exists "config_select" on public.app_config;
create policy "config_select" on public.app_config for select
  using (public.is_admin() or key = 'feature_flags');
drop policy if exists "config_admin_write" on public.app_config;
create policy "config_admin_write" on public.app_config for insert
  with check (public.is_admin());
drop policy if exists "config_admin_update" on public.app_config;
create policy "config_admin_update" on public.app_config for update
  using (public.is_admin());

-- ============================================================
-- REALTIME
-- ============================================================
do $$
begin
  begin alter publication supabase_realtime add table public.edges; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.user_alerts; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.broadcasts; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.bets; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.bankrolls; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.bankroll_history; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.app_config; exception when duplicate_object then null; end;
end $$;

-- ============================================================
-- SEED — engine config + demo edges
-- ============================================================
insert into public.app_config (key, value) values
  ('min_edge_threshold', '2.0'::jsonb),
  ('duplicate_suppression', 'true'::jsonb),
  ('pre_game_cutoff_minutes', '30'::jsonb),
  ('active_books', '["South Point","Caesars","DraftKings","Treasure Island","Wynn","Coast Casino","BetMGM","Circa"]'::jsonb),
  ('active_sports', '["NFL","NBA","MLB","NHL","NCAAF","NCAAB"]'::jsonb),
  ('feature_flags', '{"alerts_enabled":true,"maintenance_mode":false,"responsible_gambling":false}'::jsonb)
on conflict (key) do nothing;

-- Demo edges (visible immediately in the app)
do $$
declare e1 uuid; e2 uuid; e3 uuid; e4 uuid;
begin
  -- Demo seed DISABLED (2026-08-11): system is live — edges come from the
  -- odds engine (007) or manual admin publishing. Runner re-applies all files,
  -- so this guard must stay false forever.
  if false then
    insert into public.edges (sport, league, matchup, bet_type, specific_bet, local_book, local_odds, edge_pct, game_time)
      values ('NFL','NFL','New Orleans @ Indianapolis','Game Total','Over 209','South Point',-100,4.0, now() + interval '2 hours')
      returning id into e1;
    insert into public.edges (sport, league, matchup, bet_type, specific_bet, local_book, local_odds, edge_pct, game_time)
      values ('NBA','NBA','Los Angeles Lakers @ Boston Celtics','Game Spread','Lakers -5.5','Caesars',-110,2.8, now() + interval '4 hours')
      returning id into e2;
    insert into public.edges (sport, league, matchup, bet_type, specific_bet, local_book, local_odds, edge_pct, game_time)
      values ('MLB','MLB','New York Yankees @ Boston Red Sox','Moneyline','Yankees ML','DraftKings',-115,3.2, now() + interval '6 hours')
      returning id into e3;
    insert into public.edges (sport, league, matchup, bet_type, specific_bet, local_book, local_odds, edge_pct, game_time)
      values ('NCAAF','NCAA Football','Alabama @ Georgia','1st Half Spread','Alabama -4.5 1H','Treasure Island',-110,5.1, now() + interval '8 hours')
      returning id into e4;

    insert into public.edge_method (edge_id, sharp_fair_price, no_vig_prob, book_lines) values
      (e1, 100, 0.50000, '[{"book":"No-Vig Fair","type":"fair","juice":100,"line":"210"},{"book":"Pinnacle","type":"sharp","juice":-105,"line":"210"},{"book":"Bookmaker","type":"sharp","juice":-110,"line":"210"},{"book":"5Dimes","type":"sharp","juice":-110,"line":"210"},{"book":"South Point","type":"edge","juice":-100,"line":"209"}]'::jsonb),
      (e2, -120, 0.52380, '[{"book":"No-Vig Fair","type":"fair","juice":-114,"line":"-5.5"},{"book":"Pinnacle","type":"sharp","juice":-118,"line":"-5.5"},{"book":"Bookmaker","type":"sharp","juice":-120,"line":"-5.5"},{"book":"Caesars","type":"edge","juice":-110,"line":"-5.5"}]'::jsonb),
      (e3, -130, 0.55230, '[{"book":"No-Vig Fair","type":"fair","juice":-124,"line":"ML"},{"book":"Pinnacle","type":"sharp","juice":-128,"line":"ML"},{"book":"Bookmaker","type":"sharp","juice":-130,"line":"ML"},{"book":"DraftKings","type":"edge","juice":-115,"line":"ML"}]'::jsonb),
      (e4, -125, 0.53780, '[{"book":"No-Vig Fair","type":"fair","juice":-119,"line":"-4.5 1H"},{"book":"Pinnacle","type":"sharp","juice":-123,"line":"-4.5 1H"},{"book":"Bookmaker","type":"sharp","juice":-125,"line":"-4.5 1H"},{"book":"Treasure Island","type":"edge","juice":-110,"line":"-4.5 1H"}]'::jsonb);
  end if;
end $$;
