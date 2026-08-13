-- 004: profiles + user_settings were missing from the realtime publication,
-- so admin actions (promote/deactivate) persisted but never refreshed the UI.
do $$
begin
  begin alter publication supabase_realtime add table public.profiles; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.user_settings; exception when duplicate_object then null; end;
end $$;
