-- Stash: multiple readers (Google sign-in), each with their own history,
-- Library, collections and preferences. The idea pool stays shared.
-- Idempotent: safe to re-run.

create table if not exists public.users (
  id              uuid primary key default gen_random_uuid(),
  google_sub      text unique,
  email           text unique,
  name            text,
  avatar_url      text,
  role            text not null default 'member' check (role in ('owner', 'member')),
  created_at      timestamptz not null default now(),
  last_active_at  timestamptz
);

create table if not exists public.allowed_emails (
  email     text primary key,
  added_at  timestamptz not null default now()
);

create table if not exists public.access_requests (
  email         text primary key,
  name          text,
  note          text,
  google_sub    text,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  requested_at  timestamptz not null default now(),
  notified_at   timestamptz
);

-- The owner account. Its email/Google id are filled in on first Google sign-in
-- with OWNER_EMAIL (kept out of this public repo).
insert into public.users (role, name)
select 'owner', 'Owner'
where not exists (select 1 from public.users where role = 'owner');

do $$
declare
  v_owner uuid := (select id from public.users where role = 'owner' order by created_at limit 1);
begin
  -- idea_state: per user
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'idea_state' and column_name = 'user_id') then
    alter table public.idea_state add column user_id uuid references public.users(id) on delete cascade;
    update public.idea_state set user_id = v_owner where user_id is null;
    alter table public.idea_state alter column user_id set not null;
    alter table public.idea_state drop constraint if exists idea_state_pkey;
    alter table public.idea_state add primary key (user_id, idea_id);
  end if;

  -- events: per user
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'events' and column_name = 'user_id') then
    alter table public.events add column user_id uuid references public.users(id) on delete cascade;
    update public.events set user_id = v_owner where user_id is null;
    alter table public.events alter column user_id set not null;
  end if;

  -- collections: per user, names unique per user
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'collections' and column_name = 'user_id') then
    alter table public.collections add column user_id uuid references public.users(id) on delete cascade;
    update public.collections set user_id = v_owner where user_id is null;
    alter table public.collections alter column user_id set not null;
    alter table public.collections drop constraint if exists collections_name_key;
    alter table public.collections add constraint collections_user_name_key unique (user_id, name);
  end if;

  -- feed sessions: per user (old sessions are disposable)
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'feed_sessions' and column_name = 'user_id') then
    delete from public.feed_sessions;
    alter table public.feed_sessions add column user_id uuid not null references public.users(id) on delete cascade;
  end if;
end $$;

create index if not exists idea_state_user_seen_idx on public.idea_state (user_id, seen_at);
create index if not exists idea_state_user_saved_idx on public.idea_state (user_id, saved_at) where saved_at is not null;
create index if not exists events_user_kind_time_idx on public.events (user_id, kind, created_at desc);

-- ---------------------------------------------------------------------------
-- Per-user functions (old single-user signatures are dropped)
-- ---------------------------------------------------------------------------

drop function if exists public.feed_candidates(uuid, text, text, text, int);
drop function if exists public.serve_ideas(uuid, uuid[], uuid[]);
drop function if exists public.topic_affinity(double precision);
drop function if exists public.apply_event(uuid, text);
drop function if exists public.unseen_count();
drop function if exists public.buffer_stats();
drop function if exists public.seen_days(int);
drop function if exists public.search_saved(text, uuid, int, int, text);
drop function if exists public.get_cards(uuid[]);

create or replace function public.feed_candidates(
  p_user uuid, p_session uuid, p_tier text, p_topic text, p_concept text, p_limit int
) returns setof public.card_row
language plpgsql stable
set search_path = public, extensions
as $$
begin
  if p_tier = 'unseen' then
    return query
    with pool as (
      select i.*, s.seen_at as s_seen, s.saved_at as s_saved, coalesce(s.reaction, 0)::smallint as s_reaction
      from ideas i
      left join idea_state s on s.idea_id = i.id and s.user_id = p_user
      where s.seen_at is null
        and coalesce(s.reaction, 0) >= 0
        and not exists (select 1 from feed_session_items f where f.session_id = p_session and f.idea_id = i.id)
        and idea_matches(i.topics, i.tsv, i.main_concept, i.back, p_topic, p_concept)
    ),
    newest as (select * from pool order by created_at desc limit greatest(p_limit / 2, 1)),
    rnd as (select * from pool where id not in (select id from newest) order by random() limit p_limit - greatest(p_limit / 2, 1))
    select x.id, x.title, x.text, x.topics, x.why_it_matters, x.main_concept, x.back, x.learn_more_url,
           x.source_title, x.source_author, x.source_url, x.source_domain, x.created_at,
           x.s_seen, x.s_saved, x.s_reaction
    from (select * from newest union all select * from rnd) x;
  else
    -- Fallback tier kept for completeness: anything not disliked by this user.
    return query
    select i.id, i.title, i.text, i.topics, i.why_it_matters, i.main_concept, i.back, i.learn_more_url,
           i.source_title, i.source_author, i.source_url, i.source_domain, i.created_at,
           s.seen_at, s.saved_at, coalesce(s.reaction, 0)::smallint
    from ideas i left join idea_state s on s.idea_id = i.id and s.user_id = p_user
    where coalesce(s.reaction, 0) >= 0
      and not exists (select 1 from feed_session_items f where f.session_id = p_session and f.idea_id = i.id)
      and idea_matches(i.topics, i.tsv, i.main_concept, i.back, p_topic, p_concept)
    order by random()
    limit p_limit;
  end if;
end;
$$;

create or replace function public.serve_ideas(p_user uuid, p_session uuid, p_ids uuid[], p_remembered uuid[])
returns void
language plpgsql
set search_path = public, extensions
as $$
begin
  insert into feed_sessions (id, user_id) values (p_session, p_user) on conflict (id) do nothing;
  if not exists (select 1 from feed_sessions where id = p_session and user_id = p_user) then
    raise exception 'feed session belongs to another user';
  end if;
  insert into feed_session_items (session_id, idea_id)
  select p_session, unnest(p_ids) on conflict do nothing;
  insert into idea_state (user_id, idea_id, last_served_at)
  select p_user, unnest(p_ids), now()
  on conflict (user_id, idea_id) do update set last_served_at = now();
  update users set last_active_at = now() where id = p_user;
end;
$$;

create or replace function public.topic_affinity(p_user uuid, p_half_life_days double precision default 14)
returns table (topic text, score double precision)
language sql stable
set search_path = public, extensions
as $$
  select t as topic,
         sum(
           (case e.kind
              when 'save' then 3.0
              when 'like' then 2.0
              when 'share' then 2.0
              when 'flip' then 0.5
              when 'unsave' then -1.0
              when 'dislike' then -3.0
              else 0.0 end)
           * exp(-ln(2.0) * extract(epoch from (now() - e.created_at)) / 86400.0 / p_half_life_days)
         ) as score
  from events e, unnest(e.topics) t
  where e.user_id = p_user
    and e.kind in ('save', 'like', 'share', 'flip', 'unsave', 'dislike')
    and e.created_at > now() - interval '180 days'
  group by t
$$;

create or replace function public.apply_event(p_user uuid, p_id uuid, p_kind text)
returns void
language plpgsql
set search_path = public, extensions
as $$
declare
  v_topics text[];
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

  insert into events (user_id, idea_id, kind, topics) values (p_user, p_id, p_kind, coalesce(v_topics, '{}'));
end;
$$;

create or replace function public.unseen_count(p_user uuid)
returns integer
language sql stable
set search_path = public, extensions
as $$
  select count(*)::int
  from ideas i left join idea_state s on s.idea_id = i.id and s.user_id = p_user
  where s.seen_at is null and coalesce(s.reaction, 0) >= 0
$$;

-- Smallest unseen buffer among active readers (owner always counts). Ingest
-- tops up whenever this falls below the target, so the heaviest reader is covered.
create or replace function public.min_active_unseen()
returns integer
language sql stable
set search_path = public, extensions
as $$
  select coalesce(min(public.unseen_count(u.id)), (select count(*)::int from ideas))
  from users u
  where u.role = 'owner' or u.last_active_at > now() - interval '14 days'
$$;

create or replace function public.buffer_stats(p_user uuid)
returns jsonb
language sql stable
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'total', (select count(*) from ideas),
    'unseen', (select public.unseen_count(p_user)),
    'min_active_unseen', (select public.min_active_unseen()),
    'seen', (select count(*) from idea_state where user_id = p_user and seen_at is not null),
    'saved', (select count(*) from idea_state where user_id = p_user and saved_at is not null),
    'missing_back', (select count(*) from ideas where back is null),
    'pending_articles', (select count(*) from articles where status in ('pending', 'processing')),
    'by_topic', coalesce((
      select jsonb_agg(jsonb_build_object('topic', t, 'total', total, 'unseen', unseen) order by total desc)
      from (
        select t, count(*) as total,
               count(*) filter (where s.seen_at is null and coalesce(s.reaction, 0) >= 0) as unseen
        from ideas i left join idea_state s on s.idea_id = i.id and s.user_id = p_user, unnest(i.topics) t
        group by t
      ) x
    ), '[]'::jsonb)
  )
$$;

create or replace function public.seen_days(p_user uuid, p_tz_offset_minutes int)
returns table (day date)
language sql stable
set search_path = public, extensions
as $$
  select distinct (created_at - make_interval(mins => p_tz_offset_minutes))::date as day
  from events
  where user_id = p_user and kind = 'seen' and created_at > now() - interval '400 days'
  order by day desc
$$;

create or replace function public.search_saved(
  p_user uuid, p_q text, p_collection uuid, p_limit int, p_offset int, p_kind text default 'all'
) returns setof public.card_row
language sql stable
set search_path = public, extensions
as $$
  select i.id, i.title, i.text, i.topics, i.why_it_matters, i.main_concept, i.back, i.learn_more_url,
         i.source_title, i.source_author, i.source_url, i.source_domain, i.created_at,
         s.seen_at, s.saved_at, s.reaction
  from ideas i join idea_state s on s.idea_id = i.id and s.user_id = p_user
  where (
      (p_kind = 'saved' and s.saved_at is not null)
      or (p_kind = 'liked' and s.reaction = 1)
      or (p_kind not in ('saved', 'liked') and (s.saved_at is not null or s.reaction = 1))
    )
    and (p_collection is null or exists (
      select 1 from collection_items ci join collections c on c.id = ci.collection_id
      where ci.collection_id = p_collection and c.user_id = p_user and ci.idea_id = i.id))
    and (p_q is null or p_q = '' or i.tsv @@ websearch_to_tsquery('english', p_q)
         or i.text ilike '%' || p_q || '%' or i.title ilike '%' || p_q || '%')
  order by
    case when p_q is null or p_q = '' then 0
         else ts_rank(i.tsv, websearch_to_tsquery('english', p_q)) end desc,
    greatest(s.saved_at, case when s.reaction = 1 then s.last_served_at end) desc nulls last
  limit p_limit offset p_offset
$$;

create or replace function public.get_cards(p_user uuid, p_ids uuid[])
returns setof public.card_row
language sql stable
set search_path = public, extensions
as $$
  select i.id, i.title, i.text, i.topics, i.why_it_matters, i.main_concept, i.back, i.learn_more_url,
         i.source_title, i.source_author, i.source_url, i.source_domain, i.created_at,
         s.seen_at, s.saved_at, coalesce(s.reaction, 0)::smallint
  from ideas i left join idea_state s on s.idea_id = i.id and s.user_id = p_user
  where i.id = any(p_ids)
$$;

-- Per-user reading stats for the owner's People panel.
create or replace function public.user_stats()
returns table (id uuid, email text, name text, role text, created_at timestamptz, last_active_at timestamptz, seen bigint, saved bigint)
language sql stable
set search_path = public, extensions
as $$
  select u.id, u.email, u.name, u.role, u.created_at, u.last_active_at,
         count(s.idea_id) filter (where s.seen_at is not null),
         count(s.idea_id) filter (where s.saved_at is not null)
  from users u left join idea_state s on s.user_id = u.id
  group by u.id
  order by u.role, u.last_active_at desc nulls last
$$;

-- ---------------------------------------------------------------------------
-- Lockdown (new tables/functions included)
-- ---------------------------------------------------------------------------
alter table public.users           enable row level security;
alter table public.allowed_emails  enable row level security;
alter table public.access_requests enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- Is this session's user still allowed in? (owner always; members while on the list)
create or replace function public.user_access(p_user uuid)
returns table (id uuid, email text, name text, avatar_url text, role text, allowed boolean)
language sql stable
set search_path = public, extensions
as $$
  select u.id, u.email, u.name, u.avatar_url, u.role,
         (u.role = 'owner' or exists (select 1 from allowed_emails a where a.email = lower(u.email)))
  from users u where u.id = p_user
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
