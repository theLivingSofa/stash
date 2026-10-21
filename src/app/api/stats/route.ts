import type { NextRequest } from "next/server";
import { db, must } from "@/lib/db";
import { fail, isAuthed, json } from "@/lib/api";
import { computeStreak } from "@/lib/feed/streak";

export async function GET(req: NextRequest) {
  if (!(await isAuthed())) return fail(401, "unauthorized");
  // Minutes to subtract from UTC to get local time (JS getTimezoneOffset convention).
  const tz = Math.max(-840, Math.min(840, Number(req.nextUrl.searchParams.get("tz") ?? 0) || 0));
  const rows = must(await db().rpc("seen_days", { p_tz_offset_minutes: tz }), "seen_days") as { day: string }[];
  const today = new Date(Date.now() - tz * 60_000).toISOString().slice(0, 10);
  const days = rows.map((r) => r.day);
  return json({ streak: computeStreak(days, today), readToday: days.includes(today) });
}
