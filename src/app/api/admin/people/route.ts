import type { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { fail, json, requireOwner } from "@/lib/api";
import { forgetAccess } from "@/lib/auth/users";

const Query = z.object({
  q: z.string().trim().max(200).default(""),
  sort: z.enum(["new", "old", "az", "za"]).default("new"),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  summary: z.string().optional(),
});

/**
 * GET ?summary=1 -> counts for the Behind the scenes card.
 * GET ?q=&sort=new|old|az|za&offset=&limit= -> pending requests, a page of
 * approved emails (search + sort), readers, and counts.
 */
export async function GET(req: NextRequest) {
  if (!(await requireOwner())) return fail(403, "owner only");
  const p = Query.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!p.success) return fail(400, "bad query");
  const { q, sort, offset, limit, summary } = p.data;

  const [allowedCount, pendingCount, readerCount] = await Promise.all([
    db().from("allowed_emails").select("email", { count: "exact", head: true }),
    db().from("access_requests").select("email", { count: "exact", head: true }).eq("status", "pending"),
    db().from("users").select("id", { count: "exact", head: true }),
  ]);
  const counts = { allowed: allowedCount.count ?? 0, pending: pendingCount.count ?? 0, readers: readerCount.count ?? 0 };
  if (summary) return json({ counts });

  let allowedQ = db().from("allowed_emails").select("email, added_at", { count: "exact" });
  if (q) allowedQ = allowedQ.ilike("email", `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`);
  allowedQ =
    sort === "az" || sort === "za"
      ? allowedQ.order("email", { ascending: sort === "az" })
      : allowedQ.order("added_at", { ascending: sort === "old" }).order("email");
  const [requests, allowed, users] = await Promise.all([
    db().from("access_requests").select("email, name, note, status, requested_at").eq("status", "pending").order("requested_at", { ascending: false }).limit(200),
    allowedQ.range(offset, offset + limit - 1),
    db().rpc("user_stats"),
  ]);
  const total = allowed.count ?? 0;
  return json({
    counts,
    requests: requests.data ?? [],
    allowed: { items: allowed.data ?? [], total, nextOffset: offset + limit < total ? offset + limit : null },
    users: users.data ?? [],
  });
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
