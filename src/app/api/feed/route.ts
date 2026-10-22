import { after, type NextRequest } from "next/server";
import { fail, getUser, json } from "@/lib/api";
import { readCursor, signCursor } from "@/lib/auth/session";
import { buildPage, type FeedFilter } from "@/lib/feed/chain";
import { DbFeedRepo } from "@/lib/feed/repo";
import { runIngest } from "@/lib/ingest/run";
import { FeedQuery } from "@/lib/schemas";
import { ensureQuestions, prepareTrivia } from "@/lib/recall";
import { isTopic } from "@/lib/topics";
import { queryEmbedding } from "@/lib/search";
import type { FeedPage } from "@/lib/types";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const user = await getUser();
  if (!user) return fail(401, "unauthorized");
  const q = FeedQuery.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!q.success) return fail(400, "bad query");

  const cursor = q.data.cursor ? await readCursor(q.data.cursor, user.id) : null;
  const sessionId = cursor?.s ?? crypto.randomUUID();
  const page = (cursor?.p ?? 0) + 1;
  const topic = cursor ? cursor.t : q.data.topic;
  const filter: FeedFilter = {
    topic: topic && isTopic(topic) ? topic : null,
    concept: (cursor ? cursor.c : q.data.concept) || null,
  };

  if (filter.concept) filter.embedding = await queryEmbedding(filter.concept);

  const repo = new DbFeedRepo(user.id);
  let result = await buildPage(repo, { sessionId, filter });

  if (result.cards.length === 0) {
    // Every unseen idea is used up (or the library is empty). Never repeat
    // seen ideas: generate fresh ones now, then retry.
    await runIngest({ trigger: "feed", budgetMs: 45_000, force: true });
    result = await buildPage(repo, { sessionId, filter });
  }

  if (result.needIngest || result.needFocus) {
    const focusConcept = result.needFocus ? filter.concept ?? undefined : undefined;
    const focusTopic = result.needFocus && !filter.concept ? filter.topic ?? undefined : undefined;
    after(() =>
      runIngest({ trigger: "feed", budgetMs: 45_000, focusConcept, focusTopic }).catch((e) => console.error("[feed] background ingest", e)),
    );
  }

  // A recall card without its question yet: write it for next time.
  const noQuestion = result.cards.filter((c) => c.recall && !c.recall.question).map((c) => c.id);
  if (noQuestion.length) after(() => ensureQuestions(noQuestion).catch(() => 0));
  // Keep a few trivia questions written ahead for the next pages.
  if (!filter.topic && !filter.concept) after(() => prepareTrivia(user.id).catch(() => 0));

  const body: FeedPage = {
    cards: result.cards,
    pending: result.cards.length === 0 ? true : undefined,
    cursor: await signCursor({ u: user.id, s: sessionId, p: page, t: filter.topic ?? undefined, c: filter.concept ?? undefined }),
    widenedFrom: result.widenedFrom,
  };
  return json(body);
}
