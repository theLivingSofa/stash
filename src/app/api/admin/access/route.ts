import { z } from "zod";
import { fail, json, requireOwner } from "@/lib/api";
import { accessMode, setAccessMode } from "@/lib/auth/users";

/** GET/POST { mode: "invite" | "open" }: who can sign in with Google. */
export async function GET() {
  if (!(await requireOwner())) return fail(403, "owner only");
  return json({ mode: await accessMode() });
}

const Body = z.object({ mode: z.enum(["invite", "open"]) });

export async function POST(req: Request) {
  if (!(await requireOwner())) return fail(403, "owner only");
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return fail(400, "bad request");
  await setAccessMode(b.data.mode);
  return json({ mode: b.data.mode });
}
