-- The feed never repeats: once an idea has been seen it only lives in the
-- Library (if saved or liked). The Library lists saved OR liked ideas.

create or replace function public.search_saved(p_q text, p_collection uuid, p_limit int, p_offset int, p_kind text default 'all')
returns setof public.card_row
language sql stable
set search_path = public, extensions
as $$
  select i.id, i.title, i.text, i.topics, i.why_it_matters, i.main_concept, i.back, i.learn_more_url,
         i.source_title, i.source_author, i.source_url, i.source_domain, i.created_at,
         s.seen_at, s.saved_at, s.reaction
  from ideas i join idea_state s on s.idea_id = i.id
  where (
      (p_kind = 'saved' and s.saved_at is not null)
      or (p_kind = 'liked' and s.reaction = 1)
      or (p_kind not in ('saved', 'liked') and (s.saved_at is not null or s.reaction = 1))
    )
    and (p_collection is null or exists (
      select 1 from collection_items c where c.collection_id = p_collection and c.idea_id = i.id))
    and (p_q is null or p_q = '' or i.tsv @@ websearch_to_tsquery('english', p_q)
         or i.text ilike '%' || p_q || '%' or i.title ilike '%' || p_q || '%')
  order by
    case when p_q is null or p_q = '' then 0
         else ts_rank(i.tsv, websearch_to_tsquery('english', p_q)) end desc,
    greatest(s.saved_at, case when s.reaction = 1 then s.last_served_at end) desc nulls last
  limit p_limit offset p_offset
$$;

drop function if exists public.search_saved(text, uuid, int, int);

-- Unseen ideas that were dealt in a session but never seen go back into the
-- pool for the next session automatically (feed_candidates only excludes the
-- current session). Nothing else to change here.

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
