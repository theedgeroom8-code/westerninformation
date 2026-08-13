-- 011: Timezone-correct quiet hours.
-- Quiet hours were evaluated in UTC — a user in India setting 11pm–8am was
-- actually muted during their afternoon. The app now reports each device's
-- UTC offset (minutes east) and the server evaluates quiet hours in the
-- user's own local time.

alter table public.user_settings
  add column if not exists tz_offset_min int not null default 0;

do $$ begin
  alter table public.user_settings add constraint settings_tz_chk
    check (tz_offset_min between -840 and 840) not valid;  -- UTC-14..UTC+14
exception when duplicate_object then null; end $$;

create or replace function public.in_quiet_hours(s public.user_settings)
returns boolean
language sql stable
as $$
  select case
    when not s.quiet_hours_enabled then false
    when s.quiet_start = s.quiet_end then false
    else (
      with local_hour as (
        select extract(hour from (now() at time zone 'utc')
                       + make_interval(mins => s.tz_offset_min))::int as h
      )
      select case
        when s.quiet_start < s.quiet_end
          then h >= s.quiet_start and h < s.quiet_end
        else h >= s.quiet_start or h < s.quiet_end
      end
      from local_hour
    )
  end;
$$;
