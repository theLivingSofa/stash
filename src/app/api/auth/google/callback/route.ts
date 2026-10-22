import { NextResponse, type NextRequest } from "next/server";
import { AuthError, exchangeCode, redirectUriFor } from "@/lib/auth/google";
import { setSessionCookies } from "@/lib/auth/cookies";
import { OAUTH_COOKIE, PENDING_COOKIE, readTemp, signTemp } from "@/lib/auth/session";
import { accessFor, forgetAccess, upsertGoogleUser } from "@/lib/auth/users";


function back(req: NextRequest, error: string) {
  const res = NextResponse.redirect(new URL(`/login?error=${error}`, req.url));
  res.cookies.set(OAUTH_COOKIE, "", { path: "/api/auth", maxAge: 0 });
  return res;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get("error")) return back(req, "google_cancelled");
  const saved = await readTemp<{ state: string; verifier: string; next: string }>(req.cookies.get(OAUTH_COOKIE)?.value);
  const code = sp.get("code");
  if (!saved || !code || sp.get("state") !== saved.state) return back(req, "bad_state");

  let identity;
  try {
    identity = await exchangeCode(code, saved.verifier, redirectUriFor(req.nextUrl.origin));
  } catch (e) {
    const codeName = e instanceof AuthError ? e.code : "google_failed";
    console.error("[auth] google callback failed:", e instanceof Error ? e.message : e);
    return back(req, codeName === "unverified_email" ? "unverified_email" : "google_failed");
  }

  const role = await accessFor(identity.email);
  if (!role) {
    // Verified Google identity, but not on the list: offer to request access.
    const res = NextResponse.redirect(new URL("/request-access", req.url));
    res.cookies.set(PENDING_COOKIE, await signTemp({ ...identity }, "30m"), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 1800,
    });
    res.cookies.set(OAUTH_COOKIE, "", { path: "/api/auth", maxAge: 0 });
    return res;
  }

  const user = await upsertGoogleUser(identity, role);
  forgetAccess(user.id);
  const res = NextResponse.redirect(new URL(saved.next || "/", req.url));
  await setSessionCookies(res, user);
  res.cookies.set(OAUTH_COOKIE, "", { path: "/api/auth", maxAge: 0 });
  return res;
}
