-- Stash: server-side SQL functions (called via RPC with the secret key).

-- Shape returned to the app for any card.
drop type if exists public.card_row cascade;
create type public.card_row as (
  id              uuid,
  title           text,
  text            text,
  topics          text[],
  why_it_matters  text,
  main_concept    text,
  back            jsonb,
  learn_more_url  text,
  source_title    text,
  source_author   text,
  source_url      text,
  source_domain   text,
  created_at      timestamptz,
  seen_at         timestamptz,
  saved_at        timestamptz,
  reaction        smallint
);

-- Does an idea match an optional topic / concept filter?
create or replace function public.idea_matches(
  p_topics text[], p_tsv tsvector, p_main_concept text, p_back jsonb,
  p_topic text, p_concept text
) returns boolean
language sql immutable
set search_path = public, extensions
as $$
  select
    (p_topic is null or p_topic = any(p_topics))
    and (
      p_concept is null
      or p_tsv @@ websearch_to_tsquery('english', p_concept)
      or lower(coalesce(p_main_concept, '')) = lower(p_concept)
      or exists (
        select 1 from jsonb_array_elements_text(coalesce(p_back -> 'related', '[]'::jsonb)) r
        where lower(r) = lower(p_concept)
      )
    )
$$;

-- Candidate pool for one tier of the feed fallback chain.
--   unseen: never seen, not disliked (half newest, half random for variety)
--   seen:   seen but not saved, not disliked, oldest-seen first
--   saved:  saved ideas, least recently resurfaced first
--   any:    anything not disliked, random
-- All tiers skip ideas already served in this feed session.
create or replace function public.feed_candidates(
  p_session uuid, p_tier text, p_topic text, p_concept text, p_limit int
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
      left join idea_state s on s.idea_id = i.id
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

  elsif p_tier = 'seen' then
    return query
    select i.id, i.title, i.text, i.topics, i.why_it_matters, i.main_concept, i.back, i.learn_more_url,
           i.source_title, i.source_author, i.source_url, i.source_domain, i.created_at,
           s.seen_at, s.saved_at, s.reaction
    from ideas i join idea_state s on s.idea_id = i.id
    where s.seen_at is not null and s.saved_at is null and s.reaction >= 0
      and not exists (select 1 from feed_session_items f where f.session_id = p_session and f.idea_id = i.id)
      and idea_matches(i.topics, i.tsv, i.main_concept, i.back, p_topic, p_concept)
    order by s.seen_at asc
    limit p_limit;

  elsif p_tier = 'saved' then
    return query
    select i.id, i.title, i.text, i.topics, i.why_it_matters, i.main_concept, i.back, i.learn_more_url,
           i.source_title, i.source_author, i.source_url, i.source_domain, i.created_at,
           s.seen_at, s.saved_at, s.reaction
    from ideas i join idea_state s on s.idea_id = i.id
    where s.saved_at is not null
      and not exists (select 1 from feed_session_items f where f.session_id = p_session and f.idea_id = i.id)
      and idea_matches(i.topics, i.tsv, i.main_concept, i.back, p_topic, p_concept)
    order by coalesce(s.remembered_at, s.saved_at) asc
    limit p_limit;

  else
    return query
    select i.id, i.title, i.text, i.topics, i.why_it_matters, i.main_concept, i.back, i.learn_more_url,
           i.source_title, i.source_author, i.source_url, i.source_domain, i.created_at,
           s.seen_at, s.saved_at, coalesce(s.reaction, 0)::smallint
    from ideas i left join idea_state s on s.idea_id = i.id
    where coalesce(s.reaction, 0) >= 0
      and not exists (select 1 from feed_session_items f where f.session_id = p_session and f.idea_id = i.id)
      and idea_matches(i.topics, i.tsv, i.main_concept, i.back, p_topic, p_concept)
    order by random()
    limit p_limit;
  end if;
end;
$$;

-- Record that ideas were delivered in a feed session.
create or replace function public.serve_ideas(p_session uuid, p_ids uuid[], p_remembered uuid[])
returns void
language plpgsql
set search_path = public, extensions
as $$
begin
  insert into feed_sessions (id) values (p_session) on conflict (id) do nothing;
  insert into feed_session_items (session_id, idea_id)
  select p_session, unnest(p_ids) on conflict do nothing;
  insert into idea_state (idea_id, last_served_at)
  select unnest(p_ids), now()
  on conflict (idea_id) do update set last_served_at = now();
  if p_remembered is not null and array_length(p_remembered, 1) > 0 then
    update idea_state set remembered_at = now() where idea_id = any(p_remembered);
  end if;
end;
$$;

create or replace function public.reset_session(p_session uuid)
returns void
language sql
set search_path = public, extensions
as $$
  delete from feed_session_items where session_id = p_session;
$$;

-- Topic affinity from interaction events with exponential decay.
create or replace function public.topic_affinity(p_half_life_days double precision default 14)
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
  where e.kind in ('save', 'like', 'share', 'flip', 'unsave', 'dislike')
    and e.created_at > now() - interval '180 days'
  group by t
$$;

-- Apply one interaction event: updates idea_state and appends to events.
create or replace function public.apply_event(p_id uuid, p_kind text)
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

  insert into idea_state (idea_id) values (p_id) on conflict (idea_id) do nothing;

  if p_kind = 'seen' then
    update idea_state
       set seen_at = coalesce(seen_at, now()), seen_count = seen_count + 1
     where idea_id = p_id;
  elsif p_kind = 'save' then
    update idea_state set saved_at = coalesce(saved_at, now()) where idea_id = p_id;
  elsif p_kind = 'unsave' then
    update idea_state set saved_at = null where idea_id = p_id;
    delete from collection_items where idea_id = p_id;
  elsif p_kind = 'like' then
    update idea_state set reaction = 1 where idea_id = p_id;
  elsif p_kind = 'dislike' then
    update idea_state set reaction = -1 where idea_id = p_id;
  elsif p_kind = 'unreact' then
    update idea_state set reaction = 0 where idea_id = p_id;
  end if;

  insert into events (idea_id, kind, topics) values (p_id, p_kind, coalesce(v_topics, '{}'));
end;
$$;

create or replace function public.unseen_count()
returns integer
language sql stable
set search_path = public, extensions
as $$
  select count(*)::int
  from ideas i left join idea_state s on s.idea_id = i.id
  where s.seen_at is null and coalesce(s.reaction, 0) >= 0
$$;

create or replace function public.buffer_stats()
returns jsonb
language sql stable
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'total', (select count(*) from ideas),
    'unseen', (select public.unseen_count()),
    'seen', (select count(*) from idea_state where seen_at is not null),
    'saved', (select count(*) from idea_state where saved_at is not null),
    'missing_back', (select count(*) from ideas where back is null),
    'pending_articles', (select count(*) from articles where status in ('pending', 'processing')),
    'by_topic', coalesce((
      select jsonb_agg(jsonb_build_object('topic', t, 'total', total, 'unseen', unseen) order by total desc)
      from (
        select t, count(*) as total,
               count(*) filter (where s.seen_at is null and coalesce(s.reaction, 0) >= 0) as unseen
        from ideas i left join idea_state s on s.idea_id = i.id, unnest(i.topics) t
        group by t
      ) x
    ), '[]'::jsonb)
  )
$$;

-- Near-duplicate check: highest trigram similarity and cosine similarity.
create or replace function public.similar_ideas(p_text text, p_embedding extensions.vector(768) default null)
returns table (max_trgm double precision, max_cosine double precision)
language plpgsql stable
set search_path = public, extensions
as $$
declare
  v_trgm double precision := 0;
  v_cos double precision := 0;
begin
  perform set_config('pg_trgm.similarity_threshold', '0.4', true);
  select coalesce(max(similarity(i.text, p_text)), 0) into v_trgm
  from ideas i where i.text % p_text;

  if p_embedding is not null then
    select coalesce(1 - (i.embedding <=> p_embedding), 0) into v_cos
    from ideas i where i.embedding is not null
    order by i.embedding <=> p_embedding
    limit 1;
  end if;

  return query select v_trgm, coalesce(v_cos, 0);
end;
$$;

-- Distinct local days with at least one "seen" event (for the streak).
create or replace function public.seen_days(p_tz_offset_minutes int)
returns table (day date)
language sql stable
set search_path = public, extensions
as $$
  select distinct (created_at - make_interval(mins => p_tz_offset_minutes))::date as day
  from events
  where kind = 'seen' and created_at > now() - interval '400 days'
  order by day desc
$$;

-- Simple lease lock stored in app_state.
create or replace function public.try_lock(p_key text, p_ttl_seconds int)
returns boolean
language plpgsql
set search_path = public, extensions
as $$
declare
  v_ok boolean;
begin
  insert into app_state (key, value, updated_at)
  values (p_key, jsonb_build_object('until', now() + make_interval(secs => p_ttl_seconds)), now())
  on conflict (key) do update
    set value = excluded.value, updated_at = now()
    where coalesce((app_state.value ->> 'until')::timestamptz, '-infinity') < now()
  returning true into v_ok;
  return coalesce(v_ok, false);
end;
$$;

create or replace function public.release_lock(p_key text)
returns void
language sql
set search_path = public, extensions
as $$
  update app_state set value = jsonb_build_object('until', now() - interval '1 second'), updated_at = now()
  where key = p_key;
$$;

-- Claim pending articles for processing, round-robin across topics.
create or replace function public.claim_articles(p_limit int)
returns setof public.articles
language plpgsql
set search_path = public, extensions
as $$
begin
  return query
  update articles a
     set status = 'processing', attempts = a.attempts + 1, updated_at = now()
   where a.id in (
     select x.id from (
       select id, row_number() over (partition by topic order by created_at desc) as rn
       from articles
       where (status = 'pending' or (status = 'processing' and updated_at < now() - interval '10 minutes'))
         and attempts < 3
     ) x
     order by x.rn, random()
     limit p_limit
   )
  returning a.*;
end;
$$;

-- Saved ideas, optionally filtered by full-text query and collection.
create or replace function public.search_saved(p_q text, p_collection uuid, p_limit int, p_offset int)
returns setof public.card_row
language sql stable
set search_path = public, extensions
as $$
  select i.id, i.title, i.text, i.topics, i.why_it_matters, i.main_concept, i.back, i.learn_more_url,
         i.source_title, i.source_author, i.source_url, i.source_domain, i.created_at,
         s.seen_at, s.saved_at, s.reaction
  from ideas i join idea_state s on s.idea_id = i.id
  where s.saved_at is not null
    and (p_collection is null or exists (
      select 1 from collection_items c where c.collection_id = p_collection and c.idea_id = i.id))
    and (p_q is null or p_q = '' or i.tsv @@ websearch_to_tsquery('english', p_q)
         or i.text ilike '%' || p_q || '%')
  order by
    case when p_q is null or p_q = '' then 0
         else ts_rank(i.tsv, websearch_to_tsquery('english', p_q)) end desc,
    s.saved_at desc
  limit p_limit offset p_offset
$$;

create or replace function public.get_cards(p_ids uuid[])
returns setof public.card_row
language sql stable
set search_path = public, extensions
as $$
  select i.id, i.title, i.text, i.topics, i.why_it_matters, i.main_concept, i.back, i.learn_more_url,
         i.source_title, i.source_author, i.source_url, i.source_domain, i.created_at,
         s.seen_at, s.saved_at, coalesce(s.reaction, 0)::smallint
  from ideas i left join idea_state s on s.idea_id = i.id
  where i.id = any(p_ids)
$$;

create or replace function public.llm_record(p_provider text, p_model text, p_key_id text, p_ok boolean)
returns void
language sql
set search_path = public, extensions
as $$
  insert into llm_usage (day, provider, model, key_id, requests, failures)
  values (current_date, p_provider, p_model, p_key_id, 1, case when p_ok then 0 else 1 end)
  on conflict (day, provider, model, key_id) do update
    set requests = llm_usage.requests + 1,
        failures = llm_usage.failures + case when p_ok then 0 else 1 end
$$;

-- Housekeeping, called at the end of each ingest run.
create or replace function public.prune()
returns void
language sql
set search_path = public, extensions
as $$
  delete from feed_sessions where created_at < now() - interval '3 days';
  delete from login_attempts where at < now() - interval '1 day';
  delete from llm_cooldowns where until < now() - interval '2 days';
  delete from llm_usage where day < current_date - 60;
  update articles set inline_text = null where status in ('done', 'skipped', 'failed') and inline_text is not null;
  delete from articles where status in ('skipped', 'failed') and created_at < now() - interval '30 days';
$$;

-- ---------------------------------------------------------------------------
-- Lock everything down: only service_role (server) may call functions or
-- touch tables through the API.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
