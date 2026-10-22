-- One runner at a time for background jobs (e.g. read-aloud audio), so runs
-- from the schedule, the admin button and scripts never overlap.
create table if not exists job_leases (
  name text primary key,
  holder text not null,
  until timestamptz not null
);
alter table job_leases enable row level security;

create or replace function take_lease(p_name text, p_holder text, p_seconds int) returns boolean
language plpgsql as $$
declare ok boolean;
begin
  insert into job_leases (name, holder, until)
  values (p_name, p_holder, now() + make_interval(secs => p_seconds))
  on conflict (name) do update
    set holder = excluded.holder, until = excluded.until
    where job_leases.until < now() or job_leases.holder = p_holder
  returning true into ok;
  return coalesce(ok, false);
end
$$;

create or replace function release_lease(p_name text, p_holder text) returns void
language sql as $$
  update job_leases set until = now() where name = p_name and holder = p_holder
$$;

revoke all on all tables in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;
