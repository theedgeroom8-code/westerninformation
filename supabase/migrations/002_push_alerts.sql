-- 002: notification delivery preferences.
-- push_alerts: system push notifications (FCM/APNs — wired next phase).
-- In-app alerts are always on (realtime inbox). SMS is the existing sms_alerts.
alter table public.user_settings
  add column if not exists push_alerts boolean not null default true;

-- Device push tokens (one row per device) — ready for the Firebase/Expo push phase.
create table if not exists public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  token text not null,
  platform text not null default 'unknown',
  updated_at timestamptz not null default now(),
  unique (user_id, token)
);
alter table public.push_tokens enable row level security;

drop policy if exists "push_tokens_own" on public.push_tokens;
create policy "push_tokens_own" on public.push_tokens for all
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid());
