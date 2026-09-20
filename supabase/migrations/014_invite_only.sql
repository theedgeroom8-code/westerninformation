-- 014: INVITE-ONLY SIGN-UP (client decision, Sep 2026)
--
--   • Creating an account now requires an invitation code. The check lives in
--     the DATABASE (BEFORE INSERT trigger on auth.users), so it can't be
--     bypassed by calling the Supabase API directly with a modified app.
--   • Admins create / revoke / reopen invites in Admin → Invites.
--   • Codes are random, single-use by default, optionally locked to one email
--     address, and expire (default 14 days).
--   • app_config.invite_only = false reopens public sign-up later — no code
--     change needed (also the emergency off-switch if anything misbehaves).
--   • Existing accounts are untouched. A second admin login needs no new code:
--     sign up with an invite, then Admin → Users → "Make admin".

create extension if not exists pgcrypto with schema extensions;

-- ============================================================
-- INVITES
-- ============================================================
create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{6,32}$'),
  email text,                                     -- optional: only this address may use it
  note text check (note is null or char_length(note) <= 120),
  max_uses int not null default 1 check (max_uses between 1 and 1000),
  uses int not null default 0,
  redeemed_by text[] not null default '{}',       -- audit trail of who signed up with it
  expires_at timestamptz,
  revoked boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

alter table public.invites enable row level security;
drop policy if exists "invites_admin_select" on public.invites;
create policy "invites_admin_select" on public.invites for select using (public.is_admin());
-- No insert/update/delete policies on purpose: every write goes through the
-- security-definer functions below.

do $$
begin
  begin alter publication supabase_realtime add table public.invites; exception when duplicate_object then null; end;
end $$;

insert into public.app_config (key, value) values ('invite_only', 'true'::jsonb)
on conflict (key) do nothing;

-- ============================================================
-- HELPERS
-- ============================================================
-- "abcde-fgh12" → "ABCDEFGH12" (users type dashes, spaces, lowercase…)
create or replace function public.invite_norm(p text)
returns text
language sql immutable
as $$ select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')) $$;

-- 10 chars from an alphabet without look-alikes (no 0/O/1/I/L): ~8e14 codes.
create or replace function public.invite_generate_code()
returns text
language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_alpha constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_bytes bytea := extensions.gen_random_bytes(10);
  v_out text := '';
  i int;
begin
  for i in 0..9 loop
    v_out := v_out || substr(v_alpha, (get_byte(v_bytes, i) % length(v_alpha)) + 1, 1);
  end loop;
  return v_out;
end;
$$;

-- ============================================================
-- PUBLIC (anon-callable) — friendly pre-checks for the sign-up form
-- ============================================================
create or replace function public.signup_requires_invite()
returns boolean
language sql stable security definer
set search_path = public
as $$ select coalesce((public.engine_cfg('invite_only') #>> '{}')::boolean, true) $$;

-- Returns: ok | invalid | revoked | expired | used | email_mismatch
create or replace function public.check_invite(p_code text, p_email text default null)
returns text
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_code text := public.invite_norm(p_code);
  v_inv public.invites%rowtype;
begin
  if not public.signup_requires_invite() then return 'ok'; end if;
  if length(v_code) < 6 then return 'invalid'; end if;
  select * into v_inv from public.invites where code = v_code;
  if not found then return 'invalid'; end if;
  if v_inv.revoked then return 'revoked'; end if;
  if v_inv.expires_at is not null and v_inv.expires_at < now() then return 'expired'; end if;
  if v_inv.uses >= v_inv.max_uses then return 'used'; end if;
  if v_inv.email is not null and nullif(trim(coalesce(p_email, '')), '') is not null
     and lower(v_inv.email) <> lower(trim(p_email)) then
    return 'email_mismatch';
  end if;
  return 'ok';
end;
$$;

-- ============================================================
-- THE GATE — runs on every new account, whatever client created it
-- ============================================================
create or replace function public.enforce_invite_only()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_code text := public.invite_norm(new.raw_user_meta_data->>'invite_code');
  v_id uuid;
begin
  -- NOTE: the auth service re-writes user metadata right after this insert, so
  -- the code the person typed stays in THEIR OWN metadata. Harmless — it's
  -- spent (or already known to them) and only they and admins can see it.
  if not public.signup_requires_invite() then return new; end if;

  -- lock the row so two simultaneous sign-ups can't both spend the last use
  select i.id into v_id
  from public.invites i
  where i.code = v_code
    and not i.revoked
    and (i.expires_at is null or i.expires_at > now())
    and i.uses < i.max_uses
    and (i.email is null or lower(i.email) = lower(coalesce(new.email, '')))
  for update;

  if v_id is null then
    raise exception 'A valid invitation code is required to create an account';
  end if;

  update public.invites
    set uses = uses + 1,
        last_used_at = now(),
        redeemed_by = array_append(redeemed_by, lower(coalesce(new.email, '')))
    where id = v_id;

  return new;
end;
$$;

drop trigger if exists enforce_invite_only on auth.users;
create trigger enforce_invite_only
  before insert on auth.users
  for each row execute function public.enforce_invite_only();

-- ============================================================
-- ADMIN — create / manage invites (each re-checks is_admin())
-- ============================================================
create or replace function public.admin_create_invite(
  p_email text default null,
  p_note text default null,
  p_max_uses int default 1,
  p_days int default 14
)
returns text
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_code text;
  v_try int := 0;
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
begin
  if not public.is_admin() then raise exception 'Not authorized'; end if;
  if v_email is not null and v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' then
    raise exception 'That email address looks invalid';
  end if;
  if p_max_uses is null or p_max_uses < 1 or p_max_uses > 1000 then
    raise exception 'Uses must be between 1 and 1000';
  end if;
  if p_days is not null and (p_days < 1 or p_days > 3650) then
    raise exception 'Expiry must be between 1 and 3650 days';
  end if;

  loop
    v_code := public.invite_generate_code();
    begin
      insert into public.invites (code, email, note, max_uses, expires_at, created_by)
      values (
        v_code, v_email,
        left(nullif(trim(coalesce(p_note, '')), ''), 120),
        p_max_uses,
        case when p_days is null then null else now() + make_interval(days => p_days) end,
        auth.uid()
      );
      return v_code;
    exception when unique_violation then
      v_try := v_try + 1;
      if v_try > 5 then raise; end if;
    end;
  end loop;
end;
$$;

-- actions: revoke | restore | reset (uses → 0, e.g. after a typo'd email burned it) | delete
create or replace function public.admin_set_invite(p_id uuid, p_action text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Not authorized'; end if;
  case p_action
    when 'revoke'  then update public.invites set revoked = true where id = p_id;
    when 'restore' then update public.invites set revoked = false where id = p_id;
    when 'reset'   then update public.invites set uses = 0, redeemed_by = '{}', revoked = false where id = p_id;
    when 'delete'  then delete from public.invites where id = p_id;
    else raise exception 'Unknown action';
  end case;
end;
$$;

-- ============================================================
-- GRANTS — Supabase auto-grants EXECUTE to anon/authenticated, so be explicit
-- ============================================================
revoke execute on function public.enforce_invite_only() from public, anon, authenticated;
revoke execute on function public.invite_generate_code() from public, anon, authenticated;
revoke execute on function public.admin_create_invite(text, text, int, int) from public, anon;
revoke execute on function public.admin_set_invite(uuid, text) from public, anon;
grant execute on function public.admin_create_invite(text, text, int, int) to authenticated;
grant execute on function public.admin_set_invite(uuid, text) to authenticated;
grant execute on function public.signup_requires_invite() to anon, authenticated;
grant execute on function public.check_invite(text, text) to anon, authenticated;
