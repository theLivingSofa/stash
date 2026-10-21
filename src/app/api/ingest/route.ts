import type { NextRequest } from "next/server";
import { fail, json } from "@/lib/api";
import { runIngest } from "@/lib/ingest/run";

export const maxDuration = 60;

async function authorized(req: NextRequest): Promise<boolean> {
  const secret = process.env.INGEST_SECRET;
  const header = req.headers.get("authorization") ?? "";
  if (!secret || !header.startsWith("Bearer ")) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(header.slice(7).trim())),
    crypto.subtle.digest("SHA-256", enc.encode(secret)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/** Cron entry point (GitHub Actions). Bearer INGEST_SECRET. `?force=1` ignores the buffer target. */
export async function POST(req: NextRequest) {
  if (!(await authorized(req))) return fail(401, "unauthorized");
  const force = req.nextUrl.searchParams.get("force") === "1";
  const report = await runIngest({ trigger: force ? "manual" : "cron", budgetMs: 50_000, force });
  return json(report, { status: report.status === "error" ? 500 : 200 });
}
