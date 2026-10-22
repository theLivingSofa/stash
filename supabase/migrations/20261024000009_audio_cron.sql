-- Read-aloud audio on a dependable timer. GitHub's scheduled workflows can
-- run hours late, so the database's own scheduler calls the app every minute.
-- Each call does one ~40s round; a lease in the app means only one round runs
-- at a time, and calls return at once when every card already has audio.
-- The bearer token lives in Supabase Vault (name: stash_ingest_secret), never here.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname = 'stash-audio';

select cron.schedule(
  'stash-audio',
  '* * * * *',
  $job$
  select net.http_post(
    url := 'https://stashapp.tech/api/tts/backfill',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'stash_ingest_secret'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 70000
  );
  $job$
);
