/**
 * Checks that two readers don't share history: creates a throwaway member,
 * mints a session for them, and compares their feed/Library with the owner's
 * through the live API. Cleans up after itself.
 * Usage: npx tsx scripts/verify-isolation.ts [baseUrl]
 */
import { loadEnv, need } from "./_util";
import { createSessionToken } from "../src/lib/auth/session";

async function main() {
  loadEnv();
  const base = (process.argv[2] ?? need("SITE_URL")).replace(/\/$/, "");
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(need("SUPABASE_URL"), need("SUPABASE_SECRET_KEY"), { auth: { persistSession: false } });
  const testEmail = `isolation-test-${Date.now()}@example.invalid`;
  const owner = (await sb.from("users").select("id").eq("role", "owner").single()).data!;
  const member = (await sb.from("users").insert({ email: testEmail, name: "Isolation test", role: "member" }).select("id").single()).data!;
  await sb.from("allowed_emails").insert({ email: testEmail });
  const cookie = async (id: string, role: "owner" | "member") =>
    `stash_session=${await createSessionToken({ id, email: role === "owner" ? null : testEmail, role, via: "google" })}`;
  const as = async (c: string, path: string, init: RequestInit = {}) => {
    const r = await fetch(`${base}${path}`, { ...init, headers: { cookie: c, "Content-Type": "application/json", ...(init.headers ?? {}) } });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const results: [string, boolean][] = [];
  try {
    const oc = await cookie(owner.id, "owner");
    const mc = await cookie(member.id, "member");

    // Owner reads (marks seen) and saves one idea.
    const ownerFeed = await as(oc, "/api/feed");
    const [a, b] = ownerFeed.body.cards;
    await as(oc, "/api/events", { method: "POST", body: JSON.stringify({ events: [{ id: a.id, kind: "seen" }, { id: b.id, kind: "seen" }, { id: b.id, kind: "save" }] }) });

    // Member: the owner's seen ideas are still unseen for them; their Library is empty.
    const memberMe = await as(mc, "/api/me");
    results.push(["member session works", memberMe.status === 200 && memberMe.body.role === "member"]);
    const memberUnseen = (await sb.rpc("unseen_count", { p_user: member.id })).data as number;
    const ownerUnseen = (await sb.rpc("unseen_count", { p_user: owner.id })).data as number;
    results.push(["owner's seen ideas stay unseen for the member", memberUnseen >= ownerUnseen + 2]);
    const memberLib = await as(mc, "/api/stashes");
    results.push(["member Library is empty", memberLib.body.cards.length === 0]);

    // Member saves something: it must not show in the owner's Library.
    const memberFeed = await as(mc, "/api/feed");
    const c = memberFeed.body.cards.find((x: { id: string }) => x.id !== b.id);
    await as(mc, "/api/events", { method: "POST", body: JSON.stringify({ events: [{ id: c.id, kind: "save" }] }) });
    const ownerLib = await as(oc, "/api/stashes");
    const ownerIds = ownerLib.body.cards.map((x: { id: string }) => x.id);
    results.push(["owner sees own save", ownerIds.includes(b.id)]);
    results.push(["owner does not see member's save", !ownerIds.includes(c.id)]);
    const memberLib2 = await as(mc, "/api/stashes");
    results.push(["member sees only own save", memberLib2.body.cards.length === 1 && memberLib2.body.cards[0].id === c.id]);

    // Cursors can't be replayed across users.
    const stolen = await as(mc, `/api/feed?cursor=${encodeURIComponent(ownerFeed.body.cursor)}`);
    results.push(["owner's cursor gives the member a fresh session", stolen.status === 200 && !stolen.body.cards.some((x: { id: string }) => x.id === a.id)]);

    // Admin is owner-only.
    results.push(["member can't open admin", (await as(mc, "/api/admin")).status === 403]);
    results.push(["owner can open admin", (await as(oc, "/api/admin")).status === 200]);

    // Removing someone from the list locks them out (within the access cache window).
    await sb.from("allowed_emails").delete().eq("email", testEmail);
    await new Promise((r) => setTimeout(r, 61_000));
    results.push(["removed member is locked out", (await as(mc, "/api/me")).status === 401]);

    // Undo the owner's test reads so their history is untouched.
    await sb.from("idea_state").update({ seen_at: null, seen_count: 0, saved_at: null }).eq("user_id", owner.id).in("idea_id", [a.id, b.id]);
    await sb.from("events").delete().eq("user_id", owner.id).in("idea_id", [a.id, b.id]);
  } finally {
    await sb.from("allowed_emails").delete().eq("email", testEmail);
    await sb.from("users").delete().eq("id", member.id);
  }
  for (const [name, ok] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  process.exit(results.every(([, ok]) => ok) ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
