-- Natural read-aloud: when the default voice's front audio for an idea is
-- stored on B2. The feed prefers ideas that are ready to play.
alter table ideas add column if not exists audio_at timestamptz;
create index if not exists ideas_audio_pending on ideas (created_at desc) where audio_at is null;

create or replace function audio_ready_ids(p_ids uuid[]) returns setof uuid
language sql stable as $$
  select id from ideas where id = any(p_ids) and audio_at is not null
$$;

revoke all on all tables in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;
