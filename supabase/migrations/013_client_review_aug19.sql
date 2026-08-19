-- 013: Client review notes (Aug 19, 2026) — the safe, unambiguous items.
--   • FanDuel joins the monitored books (explicitly requested for KY/TN,
--     and it's a real regulated book in NV too — no cost impact, it's
--     already inside the 'us' region every poll already fetches).
--   • Nevada rotation numbers, per-user play tracking (admin/bets.tsx),
--     and "expired games drop off the board" (status='active' filter +
--     engine_expire_stale) were ALREADY live — nothing to migrate there.
--   • Poll interval (15 min) and new market types (1st-half, MLB F5) are
--     held back pending a plan-tier decision — see EMAIL/chat writeup.
--     Flipping those without more Odds API headroom would exhaust the
--     current credit balance in under two days and go dark.

insert into public.api_book_map (display_name, api_key, region) values
  ('FanDuel', 'fanduel', 'us')
on conflict (display_name) do nothing;

-- Mapping alone isn't enough — the engine only scans books listed in the
-- active_books dial (Admin → Config already shows this list).
update public.app_config
  set value = value || '["FanDuel"]'::jsonb, updated_at = now()
  where key = 'active_books' and not value ? 'FanDuel';

