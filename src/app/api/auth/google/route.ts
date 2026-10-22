import { NextResponse, type NextRequest } from "next/server";
import { authorizationUrl, googleConfig, randomToken, redirectUriFor } from "@/lib/auth/google";
import { OAUTH_COOKIE, signTemp } from "@/lib/auth/session";

/** Start Google sign-in: PKCE + state, kept in a short-lived signed cookie. */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const site = process.env.SITE_URL?.replace(/\/$/, "");
  // Always run the flow on the canonical URL so cookies and the redirect URI match.
  if (process.env.NODE_ENV === "production" && site && origin !== site) {
    return NextResponse.redirect(`${site}/api/auth/google${req.nextUrl.search}`);
  }
  let clientId: string;
  try {
    ({ clientId } = googleConfig());
  } catch {
    return NextResponse.redirect(new URL("/login?error=google_not_configured", req.url));
  }
  const next = req.nextUrl.searchParams.get("next");
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  const state = randomToken();
  const verifier = randomToken(48);
  const res = NextResponse.redirect(await authorizationUrl({ clientId, redirectUri: redirectUriFor(origin), state, verifier }));
  res.cookies.set(OAUTH_COOKIE, await signTemp({ state, verifier, next: safeNext }, "10m"), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth",
    maxAge: 600,
  });
  return res;
}
