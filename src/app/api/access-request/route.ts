import type { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { fail, json } from "@/lib/api";
import type { GoogleIdentity } from "@/lib/auth/google";
import { PENDING_COOKIE, readTemp } from "@/lib/auth/session";
import { accessRequestEmail, sendEmail, shouldNotify } from "@/lib/email";
import { ownerEmail } from "@/lib/auth/users";

const Input = z.object({ note: z.string().trim().max(300).optional() });

export async function POST(req: NextRequest) {
  const who = await readTemp<GoogleIdentity>(req.cookies.get(PENDING_COOKIE)?.value);
  if (!who?.email) return fail(401, "Sign in with Google first.");
  const parsed = Input.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail(400, "Keep the note under 300 characters.");
  const note = parsed.data.note || null;

  const { data: prev } = await db().from("access_requests").select("status, notified_at").eq("email", who.email).maybeSingle();
  await db()
    .from("access_requests")
    .upsert({ email: who.email, name: who.name, note, google_sub: who.sub, status: "pending", requested_at: new Date().toISOString() });

  if (shouldNotify(prev)) {
    const site = process.env.SITE_URL ?? req.nextUrl.origin;
    const mail = accessRequestEmail({ name: who.name, email: who.email, note }, site);
    const sent = await sendEmail({ to: ownerEmail(), ...mail });
    if (sent.ok) await db().from("access_requests").update({ notified_at: new Date().toISOString() }).eq("email", who.email);
    else console.error("[access] email failed:", sent.error);
  }
  return json({ ok: true });
}
