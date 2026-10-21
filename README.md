# Stash

A personal, single-user, mobile-first web app: an endless vertical feed of short **ideas** (≤100-word insights distilled from essays, articles and public-domain books), one card per screen. Every card has a **back side**: tap **Details** and it flips in place to a deep dive (concept, where it comes from, the thinking behind it, an example, related ideas).

- **No repeats.** Once a card has been on screen for 1.5 seconds it counts as seen and never comes back in the feed. Cards that were loaded but never reached come back next time.
- **Library.** Anything you save (bookmark) or like (heart) is kept, front and back, with full-text search and named collections.
- **Endless.** A background job keeps 500+ unseen ideas ready. If the buffer ever runs dry, the feed shows "Finding new ideas…" and fills itself. It never says "end of feed" and never recycles cards you've seen.
- **Free to run.** Vercel Hobby, Supabase Free, GitHub Actions (public repo) and free LLM tiers.

## How it works

```
GitHub Actions (every 30 min) ──POST /api/ingest (Bearer INGEST_SECRET)──▶ Next.js on Vercel
                                                                              │
   sources.ts (RSS, Wikipedia, Gutenberg, SEP…) ─▶ fetch + Readability ─▶ LLM (one call = front + back)
                                                                              │   zod-validated, deduped
                                                                              ▼
                                                                    Supabase Postgres (RLS, server-only)
                                                                              │
             phone (PWA) ◀── GET /api/feed?cursor=… (20 cards, back included) ┘
```

- **Ingest** (`src/lib/ingest/`). `run.ts` takes a DB lock, picks due sources (favouring topics with the fewest unseen ideas), queues new articles, then two workers process them under a ~50 s budget. Work is chunked and resumable: unfinished articles stay queued for the next run. Each article goes through:
  - `discover.ts`: fetch with timeouts, a real User-Agent and robots.txt checks, then Mozilla Readability.
  - Skips paywalled, empty and clickbait pages. Dedupes by canonical URL and content hash.
  - Pre-call grounding: a Wikipedia summary of the subject is passed to the LLM.
  - One LLM call returns 3–5 ideas with front and back (`prompt.ts`), validated with zod (`schemas.ts`), with one repair retry.
  - Near-duplicate filter: shingles within the batch, then `pg_trgm` and Gemini embeddings (pgvector) against everything ever stored.
  - Each idea's main concept is looked up on Wikipedia for the "Learn more" link.
- **LLM layer** (`src/lib/llm/`). Providers are tried in order: Gemini → Groq → Cerebras → OpenRouter `:free` → Mistral. Each provider can have several keys, rotated round-robin.
  - On 429, quota, 5xx or timeout, that key+model is cooled down with exponential backoff (daily quotas until UTC midnight) and the next one is tried.
  - Cooldowns and per-day usage live in the DB, so they survive across serverless invocations.
  - The server log says which provider served each call.
- **Feed** (`src/lib/feed/`). `chain.ts` builds each page:
  - Only unseen ideas are eligible.
  - Ranking (`rank.ts`): topic affinity from your saves, likes, flips and dislikes (14-day half-life), plus a freshness boost, plus about 20% exploration of under-explored topics, so no three cards in a row share a topic.
  - Topic and concept filters widen to the whole feed when they run dry, and trigger a focused ingest.
  - The cursor is signed and carries the feed session, so pages never overlap.
- **Card flip** (`src/components/IdeaCard.tsx`, `globals.css`):
  - CSS 3D `rotateY` for 350 ms, transform-only, with `will-change` only while animating. At rest on the back, the 3D transform is dropped so mobile scrolling inside the card is reliable.
  - The back is rendered on first flip, from data already in the page payload, so it's instant and works offline.
  - While a card is flipped, the feed scroller is locked (`overflow:hidden; touch-action:none`) and the back scrolls with `overscroll-behavior: contain`. Reading the back can never move the feed.
  - Focus moves to the back's header and returns to Details. The hidden side is `inert`.
- **PWA**. `app/manifest.ts`, icons in `public/icons`, and `public/sw.js`, which caches pages network-first and build assets cache-first. The last 50 cards (front and back) are kept in IndexedDB for offline reading.
- **Security**:
  - The passcode is exchanged for an httpOnly signed JWT cookie (jose, 90 days). Changing `APP_PASSCODE` logs out every session.
  - `src/proxy.ts` gates every route, and each API handler re-checks.
  - Login is rate-limited (5 attempts per 15 minutes per IP).
  - RLS is on for every table with no policies, and anon/authenticated roles have no grants. Only the server-side secret key can read or write.
  - `/api/ingest` needs `Bearer INGEST_SECRET`.

## Using it

1. Open the site on your phone and enter the passcode.
2. Swipe up and down, one idea per screen. Tap **Details** to flip; tap **Back to idea** (or the header) to flip back.
3. Heart = more like this (and keep it in the Library). Circle-minus = less like this. Bookmark = save. Speaker = read aloud. Arrow = share.
4. **Explore**: topics, or follow any concept ("Stoicism", "entropy"). **Library**: saved and liked ideas, search, collections. **Settings**: theme, text size, snap or free scroll, voice, "Refresh now", log out, and **Behind the scenes** (`/admin`: buffer, runs, providers, failing sources).

**Add to home screen:**
- **iPhone (Safari):** tap Share → **Add to Home Screen** → **Add**.
- **Android (Chrome):** tap the **⋮** menu → **Add to Home screen** (or **Install app**) → **Install**.

## Setup from scratch

Needs Node 20.9+, a free Supabase account, and the `gh` and `vercel` CLIs logged in.

```bash
npm install
cp .env.example .env.local   # paste SUPABASE_ACCESS_TOKEN and your LLM keys
npm run setup                # Supabase project + migrations, secrets, GitHub repo, Vercel deploy, Actions secrets
npm run seed                 # fill the buffer (runs the ingest pipeline locally against the live DB)
```

`npm run setup` is idempotent: it finds the existing Supabase project, repo and Vercel project before creating anything, and keeps secrets already in `.env.local`.

## Day-to-day operations

| Task | How |
| --- | --- |
| Re-run ingest now | Settings → **Refresh now**, or `gh workflow run ingest.yml -f force=true`, or `npm run ingest:local` |
| Fill the buffer quickly | `npm run seed -- 500` (target unseen count, optional minutes limit) |
| Check every source live | `npm run sources:check` |
| Check LLM keys and models | `npm run llm:check` |
| Apply new migrations | add `supabase/migrations/<timestamp>_name.sql`, then `npm run db:migrate` (or `supabase db push`) |
| Tests / lint / types | `npm test`, `npm run lint`, `npm run typecheck`, `npm run test:e2e` (Playwright, mobile touch) |

### Rotate or add LLM keys
Put several keys in one variable, comma-separated (`GROQ_API_KEYS=key1,key2`). Update `.env.local`, then:

```bash
vercel env add GROQ_API_KEYS --environment production --force --sensitive
vercel deploy --prod
```

Or just re-run `npm run setup`, which pushes every variable again and redeploys.

### Change models
Free model names change often. Defaults and update instructions are at the top of `src/lib/llm/config.ts`. To try a change without editing code, set `LLM_MODELS_<PROVIDER>` (e.g. `LLM_MODELS_GROQ=openai/gpt-oss-120b,qwen/qwen3.8-27b`) in Vercel and redeploy. `npm run llm:check` lists what each key can use.

### Add or remove sources
Edit `src/lib/ingest/sources.ts`: RSS/Atom feeds, Wikipedia categories, Gutenberg book IDs and more. Run `npm run sources:check`, then commit and push (or `vercel deploy --prod`). Failing sources are non-fatal: they're backed off automatically and listed on `/admin`.

### Rotate app secrets
- Delete `APP_PASSCODE` (or `INGEST_SECRET` / `SESSION_SECRET`) from `.env.local` and run `npm run setup`. It generates new ones, pushes them to Vercel and GitHub, and redeploys.
- Changing the passcode or `SESSION_SECRET` logs out all devices.

## Tear down

```bash
npm run teardown          # shows what would be deleted
npm run teardown -- --yes # deletes the Vercel project, the Supabase project and the GitHub repo
```

Deleting the GitHub repo needs `gh auth refresh -s delete_repo` first. Then revoke the LLM keys in each provider's console if you no longer need them.

## Notes and limits

- **Robots and blocking.** robots.txt is honoured for every crawled page. These sources were left out because they disallow bots or block automated reads: Reddit, Lobsters, the SEP RSS feed (SEP entries are read through its contents page, which is allowed), Science-Based Medicine, Ars Technica, Knowable, Merriam-Webster and NIH News in Health. Wikipedia, Wikiquote and Gutenberg are read through their official APIs and text files under their API policies.
- **Free-tier ceilings.** Gemini's free tier sometimes returns "high demand" (503). The router just moves on to the next model or provider. About 48 cron runs a day produce several hundred ideas, far more than one reader uses.
- **Supabase Free** pauses projects after a week of inactivity. The 30-minute cron keeps it active.
- **GitHub** disables schedules in public repos after 60 days without commits. The workflow re-enables itself on every run.
- **Lighthouse 12+** no longer has a "PWA" score. Installability is covered by the manifest, icons and service worker, which Chrome's installability checks accept.
