import type { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { fail, json, requireOwner } from "@/lib/api";
import { forgetAccess } from "@/lib/auth/users";

export async function GET() {
  if (!(await requireOwner())) return fail(403, "owner only");
  const [requests, allowed, users] = await Promise.all([
    db().from("access_requests").select("email, name, note, status, requested_at").order("requested_at", { ascending: false }),
    db().from("allowed_emails").select("email, added_at").order("added_at", { ascending: false }),
    db().rpc("user_stats"),
  ]);
  return json({ requests: requests.data ?? [], allowed: allowed.data ?? [], users: users.data ?? [] });
}

const Action = z.object({
  action: z.enum(["approve", "deny", "add", "remove"]),
  email: z.email().transform((e) => e.trim().toLowerCase()),
});

export async function POST(req: NextRequest) {
  if (!(await requireOwner())) return fail(403, "owner only");
  const parsed = Action.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "Enter a valid email address.");
  const { action, email } = parsed.data;
  if (action === "approve" || action === "add") {
    await db().from("allowed_emails").upsert({ email });
    await db().from("access_requests").update({ status: "approved" }).eq("email", email);
  } else if (action === "deny") {
    await db().from("access_requests").update({ status: "denied" }).eq("email", email);
  } else {
    await db().from("allowed_emails").delete().eq("email", email);
  }
  forgetAccess();
  return json({ ok: true });
}
