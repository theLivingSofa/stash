import { beforeAll, describe, expect, it } from "vitest";
import { AuthError, authorizationUrl, pkceChallenge, validateGoogleClaims } from "@/lib/auth/google";
import { createSessionToken, readCursor, signCursor, verifySessionToken } from "@/lib/auth/session";
import { accessRequestEmail, shouldNotify } from "@/lib/email";

const CLIENT = "client-123.apps.googleusercontent.com";
const NOW = Date.UTC(2026, 9, 23, 12);
const good = {
  iss: "https://accounts.google.com",
  aud: CLIENT,
  exp: Math.floor(NOW / 1000) + 600,
  sub: "1098765",
  email: "Friend@Gmail.com",
  email_verified: true,
  name: "A Friend",
  picture: "https://lh3.googleusercontent.com/x",
};

describe("validateGoogleClaims", () => {
  it("accepts a valid token and normalises the email", () => {
    const id = validateGoogleClaims({ ...good }, CLIENT, NOW);
    expect(id).toEqual({ sub: "1098765", email: "friend@gmail.com", name: "A Friend", picture: good.picture });
  });
  const bad: [string, Record<string, unknown>, string][] = [
    ["wrong issuer", { iss: "https://evil.example" }, "bad_token"],
    ["wrong audience", { aud: "someone-else" }, "bad_token"],
    ["expired", { exp: Math.floor(NOW / 1000) - 5 }, "bad_token"],
    ["missing email", { email: "" }, "bad_token"],
    ["unverified email", { email_verified: false }, "unverified_email"],
  ];
  for (const [name, patch, code] of bad) {
    it(`rejects ${name}`, () => {
      try {
        validateGoogleClaims({ ...good, ...patch }, CLIENT, NOW);
        throw new Error("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(AuthError);
        expect((e as AuthError).code).toBe(code);
      }
    });
  }
});

describe("authorization URL", () => {
  it("uses PKCE S256, state and the exact redirect URI", async () => {
    const url = new URL(await authorizationUrl({ clientId: CLIENT, redirectUri: "https://x.test/api/auth/google/callback", state: "st", verifier: "v".repeat(50) }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(await pkceChallenge("v".repeat(50)));
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.get("redirect_uri")).toBe("https://x.test/api/auth/google/callback");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
  });
  it("computes the RFC 7636 example challenge", async () => {
    expect(await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});

describe("sessions and cursors", () => {
  beforeAll(() => {
    process.env.SESSION_SECRET = "s".repeat(48);
    process.env.APP_PASSCODE = "pass-word-1234";
  });

  it("round-trips a Google member session", async () => {
    const t = await createSessionToken({ id: "u1", email: "f@x.com", role: "member", via: "google" });
    expect(await verifySessionToken(t)).toEqual({ id: "u1", email: "f@x.com", role: "member", via: "google" });
  });

  it("invalidates passcode sessions when the passcode changes, but not Google ones", async () => {
    const pass = await createSessionToken({ id: "owner", email: null, role: "owner", via: "passcode" });
    const goog = await createSessionToken({ id: "owner", email: "o@x.com", role: "owner", via: "google" });
    process.env.APP_PASSCODE = "a-new-passcode-9999";
    expect(await verifySessionToken(pass)).toBeNull();
    expect(await verifySessionToken(goog)).not.toBeNull();
    process.env.APP_PASSCODE = "pass-word-1234";
  });

  it("rejects tampered tokens", async () => {
    const t = await createSessionToken({ id: "u1", email: null, role: "member", via: "google" });
    expect(await verifySessionToken(t.slice(0, -2) + "xx")).toBeNull();
  });

  it("binds feed cursors to the user they were issued to", async () => {
    const c = await signCursor({ u: "alice", s: "sess", p: 1 });
    expect(await readCursor(c, "alice")).toMatchObject({ s: "sess", p: 1 });
    expect(await readCursor(c, "bob")).toBeNull();
  });
});

describe("access requests", () => {
  it("emails the owner at most once a day per person", () => {
    const now = Date.UTC(2026, 9, 23, 12);
    expect(shouldNotify(null, now)).toBe(true);
    expect(shouldNotify({ notified_at: new Date(now - 3_600_000).toISOString() }, now)).toBe(false);
    expect(shouldNotify({ notified_at: new Date(now - 25 * 3_600_000).toISOString() }, now)).toBe(true);
  });

  it("builds a clear email with the review link and escapes the note", () => {
    const m = accessRequestEmail({ name: "A Friend", email: "f@x.com", note: "<b>hi</b>" }, "https://stash.test/");
    expect(m.subject).toBe("A Friend is asking to join Stash");
    expect(m.text).toContain("https://stash.test/admin#people");
    expect(m.html).toContain("&lt;b&gt;hi&lt;/b&gt;");
    expect(m.html).not.toContain("<b>hi</b>");
  });
});
