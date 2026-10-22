-- App-wide settings. access: 'invite' (approved emails only) or 'open' (anyone
-- with a verified Google account; they're added to allowed_emails on sign-in,
-- so switching back to 'invite' keeps them until removed).
create table if not exists app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table app_settings enable row level security;
insert into app_settings (key, value) values ('access', 'invite') on conflict (key) do nothing;

revoke all on all tables in schema public from anon, authenticated;
grant all on all tables in schema public to service_role;
