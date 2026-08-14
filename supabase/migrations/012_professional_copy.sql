-- 012: Professional terminology in server-generated copy.
-- Client positioning: this is an information service. Push notifications and
-- history entries now say "play/amount" instead of "bet/wager".

-- Edge alert push: "· Play $X" instead of "· Bet $X"
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
            || ' · Play $' || greatest(0, round(
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

-- Manual settle: history line says "Play win · …"
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
      'Play ' || p_result || ' · ' || v_bet.sport || ' ' || v_bet.specific_bet);
  end if;
end;
$$;

-- Auto settle: result push + history line in professional terms
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
      'Play ' || p_result || ' (auto-settled) · ' || v_bet.sport || ' ' || v_bet.specific_bet);
  end if;

  select jsonb_agg(jsonb_build_object(
    'to', pt.token,
    'title', case p_result
      when 'win' then '✅ Play Won · +$' || to_char(v_pl, 'FM999999990')
      when 'loss' then '❌ Play Lost · -$' || to_char(abs(v_pl), 'FM999999990')
      else '↩️ Push — amount returned' end,
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

-- Onboarding history line
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
  values (auth.uid(), p_amount, coalesce(v_prev,0), p_amount - coalesce(v_prev,0), 'Starting balance');
end;
$$;

revoke execute on function public.engine_settle_bet(uuid, text) from public, anon, authenticated;
