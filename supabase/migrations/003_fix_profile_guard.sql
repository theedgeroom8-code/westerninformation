-- 003: protect_profile_fields blocked server-side scripts (no auth.uid()).
-- Only enforce the guard for real user sessions; direct DB / service-role
-- connections (auth.uid() is null) are trusted.
create or replace function public.protect_profile_fields()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    new.role := old.role;
    new.is_active := old.is_active;
  end if;
  return new;
end;
$$;
