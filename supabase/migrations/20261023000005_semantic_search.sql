-- Meaning-based search for the concept filter (Explore search, Related chips)
-- and the Library search. Uses the Gemini embeddings already stored per idea.

-- One embedding per distinct search phrase, so paging a filtered feed doesn't
-- re-embed the query every time.
create table if not exists public.query_embeddings (
  q           text primary key,
  embedding   extensions.vector(768) not null,
  created_at  timestamptz not null default now()
);
alter table public.query_embeddings enable row level security;

-- Ideas whose meaning is close to the query. Gemini similarities are bunched
-- (typical ~0.72-0.75, strong ~0.80-0.87), so the cut-off is relative: within
-- p_gap of the best match AND p_lift above the median. Queries with no strong
-- match (e.g. a name nobody wrote about) return nothing rather than noise.
create or replace function public.semantic_matches(
  p_embedding extensions.vector(768),
  p_gap double precision default 0.045,
  p_lift double precision default 0.05,
  p_max int default 200
) returns table (idea_id uuid, sim double precision)
language sql stable
set search_path = public, extensions
as $$
  with s as (
    select i.id, 1 - (i.embedding <=> p_embedding) as sim
    from ideas i
    where p_embedding is not null and i.embedding is not null
  ),
  stats as (
    select max(sim) as top, percentile_cont(0.5) within group (order by sim) as med from s
  )
  select s.id, s.sim
  from s, stats
  where s.sim >= greatest(stats.top - p_gap, stats.med + p_lift)
  order by s.sim desc
  limit p_max
$$;

drop function if exists public.feed_candidates(uuid, uuid, text, text, text, int);

create or replace function public.feed_candidates(
  p_user uuid, p_session uuid, p_tier text, p_topic text, p_concept text, p_limit int,
  p_embedding extensions.vector(768) default null
) returns setof public.card_row
language plpgsql stable
set search_path = public, extensions
as $$
begin
  if p_tier = 'unseen' and p_concept is not null then
    -- Concept search: keyword OR meaning matches, best first.
    return query
    with sem as (select * from semantic_matches(p_embedding)),
    pool as (
      select i.*, s.seen_at as s_seen, s.saved_at as s_saved, coalesce(s.reaction, 0)::smallint as s_reaction,
             idea_matches(i.topics, i.tsv, i.main_concept, i.back, p_topic, p_concept) as kw,
             case when p_embedding is not null and i.embedding is not null
                  then 1 - (i.embedding <=> p_embedding) else 0 end as sim
      from ideas i
      left join idea_state s on s.idea_id = i.id and s.user_id = p_user
      where s.seen_at is null
        and coalesce(s.reaction, 0) >= 0
        and not exists (select 1 from feed_session_items f where f.session_id = p_session and f.idea_id = i.id)
        and (p_topic is null or p_topic = any(i.topics))
        and (idea_matches(i.topics, i.tsv, i.main_concept, i.back, p_topic, p_concept)
             or i.id in (select idea_id from sem))
    )
    select x.id, x.title, x.text, x.topics, x.why_it_matters, x.main_concept, x.back, x.learn_more_url,
           x.source_title, x.source_author, x.source_url, x.source_domain, x.created_at,
           x.s_seen, x.s_saved, x.s_reaction
    from pool x
    order by (case when x.kw then 0.1 else 0 end) + x.sim desc, x.created_at desc
    limit p_limit;

  elsif p_tier = 'unseen' then
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

drop function if exists public.search_saved(uuid, text, uuid, int, int, text);

create or replace function public.search_saved(
  p_user uuid, p_q text, p_collection uuid, p_limit int, p_offset int, p_kind text default 'all',
  p_embedding extensions.vector(768) default null
) returns setof public.card_row
language sql stable
set search_path = public, extensions
as $$
  with sem as (select * from semantic_matches(p_embedding))
  select i.id, i.title, i.text, i.topics, i.why_it_matters, i.main_concept, i.back, i.learn_more_url,
         i.source_title, i.source_author, i.source_url, i.source_domain, i.created_at,
         s.seen_at, s.saved_at, s.reaction
  from ideas i
  join idea_state s on s.idea_id = i.id and s.user_id = p_user
  left join sem on sem.idea_id = i.id
  where (
      (p_kind = 'saved' and s.saved_at is not null)
      or (p_kind = 'liked' and s.reaction = 1)
      or (p_kind not in ('saved', 'liked') and (s.saved_at is not null or s.reaction = 1))
    )
    and (p_collection is null or exists (
      select 1 from collection_items ci join collections c on c.id = ci.collection_id
      where ci.collection_id = p_collection and c.user_id = p_user and ci.idea_id = i.id))
    and (p_q is null or p_q = ''
         or i.tsv @@ websearch_to_tsquery('english', p_q)
         or i.text ilike '%' || p_q || '%' or i.title ilike '%' || p_q || '%'
         or sem.idea_id is not null)
  order by
    case when p_q is null or p_q = '' then 0
         else ts_rank(i.tsv, websearch_to_tsquery('english', p_q)) + coalesce(sem.sim, 0) end desc,
    greatest(s.saved_at, case when s.reaction = 1 then s.last_served_at end) desc nulls last
  limit p_limit offset p_offset
$$;

revoke all on all tables in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;
