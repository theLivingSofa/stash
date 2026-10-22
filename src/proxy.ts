import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "./lib/auth/session";

const PUBLIC = new Set([
  "/login",
  "/api/login",
  "/api/ingest",
  "/api/auth/google",
  "/api/auth/google/callback",
  "/request-access",
  "/api/access-request",
]);

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC.has(pathname)) return NextResponse.next();

  const ok = !!(await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value));
  if (ok) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    // Everything except static assets and PWA files.
    "/((?!_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|sw.js|robots.txt|offline.html).*)",
  ],
};
