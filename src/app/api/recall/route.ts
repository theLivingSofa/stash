import { z } from "zod";
import { fail, getUser, json } from "@/lib/api";
import { answerRecall } from "@/lib/recall";

const Body = z.object({ id: z.uuid(), ok: z.boolean() });

/** POST { id, ok }: the reader remembered (ok) or not; returns days until it comes back. */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return fail(401, "unauthorized");
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return fail(400, "bad request");
  const days = await answerRecall(user.id, b.data.id, b.data.ok);
  return json({ days });
}
