-- Interests picked on first sign-in, and spaced recall of saved/liked ideas.

alter table users add column if not exists interests text[] not null default '{}';
alter table users add column if not exists onboarded_at timestamptz;

-- One short recall question per idea (written by the LLM once, on first save).
alter table ideas add column if not exists recall_q text;

-- Leitner-style schedule per reader: box 0..5 -> 1, 3, 7, 21, 60, 180 days.
create table if not exists recall (
  user_id uuid not null references users(id) on delete cascade,
  idea_id uuid not null references ideas(id) on delete cascade,
  box smallint not null default 0,
  due_at timestamptz not null,
  last_at timestamptz,
  primary key (user_id, idea_id)
);
alter table recall enable row level security;
create index if not exists recall_due on recall (user_id, due_at);

create or replace function recall_interval(p_box int) returns interval
language sql immutable as $$
  select make_interval(days => (array[1, 3, 7, 21, 60, 180])[least(greatest(p_box, 0), 5) + 1])
$$;

-- Saving or liking schedules a recall; un-saving/un-liking (when neither is left) drops it.
create or replace function public.apply_event(p_user uuid, p_id uuid, p_kind text)
returns void
language plpgsql
set search_path = public, extensions
as $$
declare
  v_topics text[];
  v_keep boolean;
begin
  select topics into v_topics from ideas where id = p_id;
  if not found then
    return;
  end if;

  insert into idea_state (user_id, idea_id) values (p_user, p_id) on conflict (user_id, idea_id) do nothing;

  if p_kind = 'seen' then
    update idea_state set seen_at = coalesce(seen_at, now()), seen_count = seen_count + 1
     where user_id = p_user and idea_id = p_id;
  elsif p_kind = 'save' then
    update idea_state set saved_at = coalesce(saved_at, now()) where user_id = p_user and idea_id = p_id;
  elsif p_kind = 'unsave' then
    update idea_state set saved_at = null where user_id = p_user and idea_id = p_id;
    delete from collection_items ci using collections c
     where ci.collection_id = c.id and c.user_id = p_user and ci.idea_id = p_id;
  elsif p_kind = 'like' then
    update idea_state set reaction = 1 where user_id = p_user and idea_id = p_id;
  elsif p_kind = 'dislike' then
    update idea_state set reaction = -1 where user_id = p_user and idea_id = p_id;
  elsif p_kind = 'unreact' then
    update idea_state set reaction = 0 where user_id = p_user and idea_id = p_id;
  end if;

  if p_kind in ('save', 'like') then
    insert into recall (user_id, idea_id, due_at) values (p_user, p_id, now() + recall_interval(0))
    on conflict (user_id, idea_id) do nothing;
  elsif p_kind in ('unsave', 'unreact', 'dislike') then
    select (saved_at is not null or reaction = 1) into v_keep from idea_state where user_id = p_user and idea_id = p_id;
    if not coalesce(v_keep, false) then
      delete from recall where user_id = p_user and idea_id = p_id;
    end if;
  end if;

  insert into events (user_id, idea_id, kind, topics) values (p_user, p_id, p_kind, coalesce(v_topics, '{}'));
end;
$$;

-- Due recalls not already dealt in this feed session, oldest due first.
create or replace function recall_due(p_user uuid, p_session uuid, p_limit int)
returns table (idea_id uuid, box smallint, question text)
language sql stable as $$
  select r.idea_id, r.box, i.recall_q
  from recall r join ideas i on i.id = r.idea_id
  where r.user_id = p_user and r.due_at <= now()
    and not exists (select 1 from feed_session_items f where f.session_id = p_session and f.idea_id = r.idea_id)
  order by r.due_at
  limit p_limit
$$;

-- Answer a recall: remembered -> next box; not yet -> back to box 0. Returns days until next.
create or replace function recall_answer(p_user uuid, p_idea uuid, p_ok boolean)
returns int
language plpgsql as $$
declare v_box int;
begin
  update recall
     set box = case when p_ok then least(box + 1, 5) else 0 end,
         last_at = now(),
         due_at = now() + recall_interval(case when p_ok then least(box + 1, 5) else 0 end)
   where user_id = p_user and idea_id = p_idea
  returning box into v_box;
  if v_box is null then return null; end if;
  return extract(day from recall_interval(v_box))::int;
end
$$;

-- Existing saves/likes join the schedule (due a day after they were kept).
insert into recall (user_id, idea_id, due_at)
select s.user_id, s.idea_id, coalesce(s.saved_at, s.last_served_at, now()) + interval '1 day'
from idea_state s
where s.saved_at is not null or s.reaction = 1
on conflict (user_id, idea_id) do nothing;

revoke all on all tables in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;
