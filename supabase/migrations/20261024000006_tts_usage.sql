-- Natural read-aloud: characters sent to Azure each month, so the app stays
-- inside the free allowance and never bills.
create table if not exists tts_usage (
  month text primary key,
  chars bigint not null default 0,
  requests int not null default 0,
  updated_at timestamptz not null default now()
);
alter table tts_usage enable row level security;

-- Adds p_chars to this month's total if it stays within p_limit; returns the
-- new total, or null when it would go over. A negative p_chars refunds.
create or replace function tts_charge(p_chars int, p_limit bigint) returns bigint
language plpgsql as $$
declare
  m text := to_char(now() at time zone 'utc', 'YYYY-MM');
  total bigint;
begin
  insert into tts_usage (month) values (m) on conflict (month) do nothing;
  update tts_usage
     set chars = greatest(chars + p_chars, 0),
         requests = requests + case when p_chars > 0 then 1 else 0 end,
         updated_at = now()
   where month = m and (p_chars <= 0 or chars + p_chars <= p_limit)
  returning chars into total;
  return total;
end
$$;

create or replace function tts_used() returns bigint
language sql stable as $$
  select coalesce((select chars from tts_usage where month = to_char(now() at time zone 'utc', 'YYYY-MM')), 0)
$$;

revoke all on all tables in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;
