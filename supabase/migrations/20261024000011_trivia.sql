-- Trivia: questions about ideas a reader has read but not kept.
create table if not exists trivia_log (
  user_id uuid not null references users(id) on delete cascade,
  idea_id uuid not null references ideas(id) on delete cascade,
  asked_at timestamptz not null default now(),
  ok boolean,
  primary key (user_id, idea_id, asked_at)
);
alter table trivia_log enable row level security;

-- Read (over an hour ago), not saved, liked or disliked, not quizzed in 30 days, not dealt this session.
create or replace function trivia_pool(p_user uuid, p_session uuid)
returns table (idea_id uuid, question text)
language sql stable as $$
  select s.idea_id, i.recall_q
  from idea_state s join ideas i on i.id = s.idea_id
  where s.user_id = p_user
    and s.seen_at is not null and s.seen_at < now() - interval '1 hour'
    and s.saved_at is null and coalesce(s.reaction, 0) = 0
    and not exists (select 1 from trivia_log t where t.user_id = p_user and t.idea_id = s.idea_id and t.asked_at > now() - interval '30 days')
    and (p_session is null or not exists (select 1 from feed_session_items f where f.session_id = p_session and f.idea_id = s.idea_id))
$$;

-- One random trivia whose question is already written.
create or replace function trivia_pick(p_user uuid, p_session uuid)
returns table (idea_id uuid, question text)
language sql volatile as $$
  select idea_id, question from trivia_pool(p_user, p_session) where question is not null order by random() limit 1
$$;

-- How many are ready, and a few random ones that still need a question written.
create or replace function trivia_ready_count(p_user uuid) returns int
language sql stable as $$
  select count(*)::int from trivia_pool(p_user, null) where question is not null
$$;

create or replace function trivia_to_prepare(p_user uuid, p_n int) returns setof uuid
language sql volatile as $$
  select idea_id from trivia_pool(p_user, null) where question is null order by random() limit p_n
$$;

revoke all on all tables in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;
