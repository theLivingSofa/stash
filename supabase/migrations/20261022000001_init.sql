-- Stash: initial schema.
-- Every statement is idempotent so this file can be applied by
-- `supabase db push` or by scripts/migrate.ts without harm on re-runs.

create extension if not exists vector with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

-- ---------------------------------------------------------------------------
-- Content
-- ---------------------------------------------------------------------------

create table if not exists public.sources (
  id              text primary key,
  name            text not null,
  url             text not null,
  kind            text not null,
  topic           text not null,
  enabled         boolean not null default true,
  last_polled_at  timestamptz,
  last_ok_at      timestamptz,
  fail_count      integer not null default 0,
  last_error      text,
  items_found     integer not null default 0,
  ideas_created   integer not null default 0,
  updated_at      timestamptz not null default now()
);

create table if not exists public.articles (
  id             bigint generated always as identity primary key,
  source_id      text not null,
  topic          text not null,
  url            text not null,
  canonical_url  text not null unique,
  content_hash   text unique,
  title          text not null default '',
  author         text,
  domain         text not null default '',
  -- Some sources (Wikipedia, Gutenberg, feeds with full content) hand us the
  -- text directly; it is kept here until processed, then cleared.
  inline_text    text,
  status         text not null default 'pending'
                 check (status in ('pending', 'processing', 'done', 'skipped', 'failed')),
  reason         text,
  attempts       integer not null default 0,
  ideas_count    integer not null default 0,
  published_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists articles_status_idx on public.articles (status, created_at);

create table if not exists public.ideas (
  id              uuid primary key default gen_random_uuid(),
  article_id      bigint references public.articles(id) on delete set null,
  title           text,
  text            text not null,
  topics          text[] not null default '{}',
  why_it_matters  text,
  main_concept    text,
  back            jsonb,
  learn_more_url  text,
  source_title    text not null default '',
  source_author   text,
  source_url      text not null default '',
  source_domain   text not null default '',
  provider        text,
  model           text,
  embedding       extensions.vector(768),
  created_at      timestamptz not null default now(),
  tsv tsvector generated always as (
    to_tsvector('english',
      coalesce(title, '') || ' ' || text || ' ' ||
      coalesce(main_concept, '') || ' ' ||
      coalesce(back ->> 'concept', '') || ' ' ||
      coalesce(back ->> 'origin', ''))
  ) stored
);
create index if not exists ideas_created_idx on public.ideas (created_at desc);
create index if not exists ideas_topics_idx on public.ideas using gin (topics);
create index if not exists ideas_tsv_idx on public.ideas using gin (tsv);
create index if not exists ideas_text_trgm_idx on public.ideas using gin (text extensions.gin_trgm_ops);
create index if not exists ideas_back_related_idx on public.ideas using gin ((back -> 'related'));
create index if not exists ideas_embedding_idx on public.ideas using hnsw (embedding extensions.vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- Personal state
-- ---------------------------------------------------------------------------

create table if not exists public.idea_state (
  idea_id         uuid primary key references public.ideas(id) on delete cascade,
  seen_at         timestamptz,
  seen_count      integer not null default 0,
  last_served_at  timestamptz,
  saved_at        timestamptz,
  reaction        smallint not null default 0 check (reaction between -1 and 1),
  remembered_at   timestamptz
);
create index if not exists idea_state_seen_idx on public.idea_state (seen_at);
create index if not exists idea_state_saved_idx on public.idea_state (saved_at) where saved_at is not null;

create table if not exists public.events (
  id          bigint generated always as identity primary key,
  idea_id     uuid references public.ideas(id) on delete cascade,
  kind        text not null check (kind in ('seen', 'save', 'unsave', 'like', 'dislike', 'unreact', 'flip', 'share')),
  topics      text[] not null default '{}',
  created_at  timestamptz not null default now()
);
create index if not exists events_kind_time_idx on public.events (kind, created_at desc);

create table if not exists public.collections (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  created_at  timestamptz not null default now()
);

create table if not exists public.collection_items (
  collection_id  uuid not null references public.collections(id) on delete cascade,
  idea_id        uuid not null references public.ideas(id) on delete cascade,
  added_at       timestamptz not null default now(),
  primary key (collection_id, idea_id)
);

create table if not exists public.feed_sessions (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now()
);

create table if not exists public.feed_session_items (
  session_id  uuid not null references public.feed_sessions(id) on delete cascade,
  idea_id     uuid not null references public.ideas(id) on delete cascade,
  served_at   timestamptz not null default now(),
  primary key (session_id, idea_id)
);

-- ---------------------------------------------------------------------------
-- Operations
-- ---------------------------------------------------------------------------

create table if not exists public.llm_usage (
  day       date not null,
  provider  text not null,
  model     text not null,
  key_id    text not null,
  requests  integer not null default 0,
  failures  integer not null default 0,
  primary key (day, provider, model, key_id)
);

create table if not exists public.llm_cooldowns (
  provider    text not null,
  model       text not null,
  key_id      text not null,
  until       timestamptz not null,
  level       integer not null default 0,
  last_error  text,
  updated_at  timestamptz not null default now(),
  primary key (provider, model, key_id)
);

create table if not exists public.ingest_runs (
  id                  bigint generated always as identity primary key,
  trigger             text not null,
  status              text not null default 'running',
  started_at          timestamptz not null default now(),
  finished_at         timestamptz,
  sources_polled      integer not null default 0,
  articles_found      integer not null default 0,
  articles_processed  integer not null default 0,
  ideas_created       integer not null default 0,
  ideas_rejected      integer not null default 0,
  providers           jsonb not null default '{}'::jsonb,
  errors              jsonb not null default '[]'::jsonb,
  note                text
);
create index if not exists ingest_runs_started_idx on public.ingest_runs (started_at desc);

create table if not exists public.login_attempts (
  id  bigint generated always as identity primary key,
  ip  text not null,
  at  timestamptz not null default now()
);
create index if not exists login_attempts_ip_idx on public.login_attempts (ip, at desc);

create table if not exists public.app_state (
  key         text primary key,
  value       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row level security: on everywhere, no policies. Only the server (secret /
-- service-role key, which bypasses RLS) can read or write anything.
-- ---------------------------------------------------------------------------

alter table public.sources            enable row level security;
alter table public.articles           enable row level security;
alter table public.ideas              enable row level security;
alter table public.idea_state         enable row level security;
alter table public.events             enable row level security;
alter table public.collections        enable row level security;
alter table public.collection_items   enable row level security;
alter table public.feed_sessions      enable row level security;
alter table public.feed_session_items enable row level security;
alter table public.llm_usage          enable row level security;
alter table public.llm_cooldowns      enable row level security;
alter table public.ingest_runs        enable row level security;
alter table public.login_attempts     enable row level security;
alter table public.app_state          enable row level security;
