-- 020: Real background web push notifications.
--
-- Finding: the website's current "browser notification" (lib/webNotify.ts,
-- `new Notification(...)`) only works while the tab is open (even if hidden/
-- minimized) — and per MDN + a linked Chromium bug, that constructor "throws
-- a TypeError in nearly all mobile browsers" (verified against MDN's own
-- Notification() page). So today, on mobile — Android AND iOS — zero
-- background/external notifications are actually delivered; only desktop
-- tabs (left open) get one. On iOS specifically, WebKit's own blog
-- (webkit.org/blog/13878) confirms Web Push requires the site to be added
-- to the Home Screen first (iOS 16.4+) — a plain Safari tab cannot receive
-- push at all, installed or not.
--
-- This migration adds the DB side of real Web Push: a subscription table
-- (filled by the browser's PushManager, via the service worker added in
-- public/sw.js) and triggers that fan out to a small Vercel relay — Postgres
-- can POST JSON (pg_net already does this for Expo push), but it cannot do
-- the VAPID-signing / payload-encryption the Web Push protocol requires;
-- that crypto lives in the relay (api/web-push-relay.js) via the `web-push`
-- npm package. No business account needed for this one (unlike Twilio) —
-- VAPID keys are self-issued, no carrier/LLC involved.

create table if not exists public.web_push_subscriptions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, endpoint)
);
create index if not exists web_push_subscriptions_user_idx on public.web_push_subscriptions (user_id);

alter table public.web_push_subscriptions enable row level security;
drop policy if exists "web_push_subscriptions_own" on public.web_push_subscriptions;
create policy "web_push_subscriptions_own" on public.web_push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "web_push_subscriptions_admin_select" on public.web_push_subscriptions;
create policy "web_push_subscriptions_admin_select" on public.web_push_subscriptions
  for select using (public.is_admin());

-- Shared secret so random internet traffic can't make the relay spam pushes
-- on our behalf — same private.secrets table odds_api_key already lives in.
insert into private.secrets (name, value)
values ('web_push_relay_secret', '79b0b8ce42a99e5790c6c0f1c88f16d80cc3c3b8f55033ea8445c834a8c2ffcb')
on conflict (name) do nothing;

create or replace function public.web_push_relay(p_payload jsonb)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  select value into v_secret from private.secrets where name = 'web_push_relay_secret';
  if v_secret is null then return; end if;
  perform net.http_post(
    url := 'https://westerninformationnetwork.com/api/web-push-relay',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-relay-secret', v_secret),
    body := p_payload
  );
end;
$$;
revoke execute on function public.web_push_relay(jsonb) from public, anon, authenticated;

-- ---------- edge published → web push to opted-in, subscribed users ----------
-- One item per subscription, each with ITS OWN personalized body (the
-- suggested $ amount depends on that user's bankroll/kelly setting — same
-- reason push_notify_edge computes it per-row, not once for the whole batch).
create or replace function public.web_push_notify_edge()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_items jsonb;
  v_title text := '⚡ ' || to_char(new.edge_pct, 'FM990.0') || '% Edge — ' || new.sport;
  v_high_threshold numeric := coalesce((public.engine_cfg('high_edge_threshold') #>> '{}')::numeric, 5.0);
begin
  if not public.edge_alerts_enabled() then return new; end if;
  if new.edge_pct < v_high_threshold then return new; end if;

  select jsonb_agg(jsonb_build_object(
    'subscription', jsonb_build_object(
      'endpoint', ws.endpoint,
      'keys', jsonb_build_object('p256dh', ws.p256dh, 'auth', ws.auth_key)
    ),
    'payload', jsonb_build_object(
      'title', v_title,
      'body', public.engine_edge_alert_text(new, coalesce(b.balance, 0), s.kelly_fraction),
      'data', jsonb_build_object('type', 'edge', 'edgeId', new.id)
    )
  ))
  into v_items
  from public.web_push_subscriptions ws
  join public.profiles p on p.id = ws.user_id and p.is_active
  join public.user_settings s on s.user_id = ws.user_id
  left join public.bankrolls b on b.user_id = ws.user_id
  where s.push_alerts
    and not public.in_quiet_hours(s);

  if v_items is not null then
    perform public.web_push_relay(jsonb_build_object('items', v_items));
  end if;
  return new;
end;
$$;
drop trigger if exists web_push_notify_edge on public.edges;
create trigger web_push_notify_edge
  after insert on public.edges
  for each row execute function public.web_push_notify_edge();

-- ---------- broadcast → web push, mirrors push_notify_broadcast ----------
create or replace function public.web_push_notify_broadcast()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare v_items jsonb;
begin
  select jsonb_agg(jsonb_build_object(
    'subscription', jsonb_build_object(
      'endpoint', ws.endpoint,
      'keys', jsonb_build_object('p256dh', ws.p256dh, 'auth', ws.auth_key)
    ),
    'payload', jsonb_build_object(
      'title', '📣 ' || new.title,
      'body', new.message,
      'data', jsonb_build_object('type', 'broadcast')
    )
  ))
  into v_items
  from public.web_push_subscriptions ws
  join public.profiles p on p.id = ws.user_id and p.is_active
  join public.user_settings s on s.user_id = ws.user_id
  where s.push_alerts
    and not public.in_quiet_hours(s);

  if v_items is not null then
    perform public.web_push_relay(jsonb_build_object('items', v_items));
  end if;
  return new;
end;
$$;
drop trigger if exists web_push_notify_broadcast on public.broadcasts;
create trigger web_push_notify_broadcast
  after insert on public.broadcasts
  for each row execute function public.web_push_notify_broadcast();

revoke execute on function public.web_push_notify_edge() from public, anon, authenticated;
revoke execute on function public.web_push_notify_broadcast() from public, anon, authenticated;
