-- 015: ADMIN — permanently delete a user account (client request, Sep 2026)
--
--   • Deletes the row in auth.users. Every app table keys off profiles.id
--     with "on delete cascade" (profiles, user_settings, bankrolls,
--     bankroll_history, bets, user_alerts, push_tokens), and Supabase's own
--     auth.* tables (identities, sessions, mfa factors, refresh tokens)
--     cascade the same way — so one delete erases the whole account.
--   • edges.created_by / broadcasts.created_by / invites.created_by are
--     "on delete set null" — any content the person created stays, just
--     unattributed, exactly like the existing account-deactivation flow.
--   • Blocked: deleting your own account (ask another admin), and deleting
--     the last remaining active administrator.

create or replace function public.admin_delete_user(p_id uuid)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  v_email text;
  v_role text;
  v_admin_count int;
begin
  if not public.is_admin() then raise exception 'Not authorized'; end if;
  if p_id = auth.uid() then
    raise exception 'You can''t delete your own account here — ask another admin';
  end if;

  select email, role into v_email, v_role from public.profiles where id = p_id;
  if not found then raise exception 'User not found'; end if;

  if v_role = 'admin' then
    select count(*) into v_admin_count from public.profiles where role = 'admin' and is_active;
    if v_admin_count <= 1 then
      raise exception 'Can''t delete the only administrator';
    end if;
  end if;

  delete from auth.users where id = p_id;
  return v_email;
end;
$$;

revoke execute on function public.admin_delete_user(uuid) from public, anon;
grant execute on function public.admin_delete_user(uuid) to authenticated;
