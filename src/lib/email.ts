import "server-only";

/**
 * Email via Resend's free tier. With no verified domain, Resend only delivers
 * from onboarding@resend.dev to the account owner's own address, which is
 * exactly who access requests go to.
 */
export async function sendEmail(msg: { to: string; subject: string; text: string; html: string }): Promise<{ ok: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: "RESEND_API_KEY is not set" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: "Stash <onboarding@resend.dev>", to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { ok: false, error: `Resend HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function accessRequestEmail(req: { name: string | null; email: string; note: string | null }, siteUrl: string) {
  const who = req.name ? `${req.name} (${req.email})` : req.email;
  const link = `${siteUrl.replace(/\/$/, "")}/admin/people?tab=requests`;
  const subject = `${req.name ?? req.email} is asking to join Stash`;
  const text = [
    `${who} signed in with Google and is asking for access to Stash.`,
    req.note ? `\nTheir note: "${req.note}"` : "",
    `\nApprove or deny: ${link}`,
  ].join("\n");
  const html = `<div style="font-family:Georgia,serif;font-size:16px;line-height:1.6;color:#182136">
<p><strong>${esc(who)}</strong> signed in with Google and is asking for access to Stash.</p>
${req.note ? `<p style="border-left:3px solid #f0b44c;padding-left:12px;color:#4d5669">${esc(req.note)}</p>` : ""}
<p><a href="${esc(link)}" style="display:inline-block;background:#9a5f0c;color:#fff8ec;padding:10px 16px;border-radius:12px;text-decoration:none;font-family:system-ui,sans-serif">Review the request</a></p>
<p style="font-size:13px;color:#5f687d">You're getting this because you own this Stash.</p></div>`;
  return { subject, text, html };
}

const RENOTIFY_MS = 24 * 3_600_000;

/** Email the owner about a request at most once a day per person. */
export function shouldNotify(prev: { notified_at: string | null } | null, now = Date.now()): boolean {
  if (!prev?.notified_at) return true;
  return now - new Date(prev.notified_at).getTime() >= RENOTIFY_MS;
}
