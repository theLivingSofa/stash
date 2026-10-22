import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const jwks = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

export class AuthError extends Error {
  constructor(public code: "bad_state" | "token_exchange" | "bad_token" | "unverified_email" | "not_configured", message?: string) {
    super(message ?? code);
  }
}

export interface GoogleIdentity {
  sub: string;
  email: string;
  name: string | null;
  picture: string | null;
}

export function googleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new AuthError("not_configured", "Google sign-in isn't configured");
  return { clientId, clientSecret };
}

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** PKCE S256 challenge for a verifier. */
export async function pkceChallenge(verifier: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}

export async function authorizationUrl(opts: { clientId: string; redirectUri: string; state: string; verifier: string }): Promise<string> {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: opts.state,
    code_challenge: await pkceChallenge(opts.verifier),
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return `${GOOGLE_AUTH_URL}?${params}`;
}

/** Checks on an ID token's claims (signature is verified separately). Pure, so it's unit-tested. */
export function validateGoogleClaims(claims: JWTPayload & Record<string, unknown>, clientId: string, now = Date.now()): GoogleIdentity {
  if (!claims.iss || !ISSUERS.includes(claims.iss)) throw new AuthError("bad_token", "wrong issuer");
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(clientId)) throw new AuthError("bad_token", "wrong audience");
  if (typeof claims.exp !== "number" || claims.exp * 1000 < now) throw new AuthError("bad_token", "expired");
  if (typeof claims.sub !== "string" || !claims.sub) throw new AuthError("bad_token", "missing subject");
  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  if (!email) throw new AuthError("bad_token", "missing email");
  if (claims.email_verified !== true && claims.email_verified !== "true") throw new AuthError("unverified_email");
  return {
    sub: claims.sub,
    email,
    name: typeof claims.name === "string" ? claims.name : null,
    picture: typeof claims.picture === "string" ? claims.picture : null,
  };
}

/** Exchange the authorization code and verify the returned ID token. */
export async function exchangeCode(code: string, verifier: string, redirectUri: string): Promise<GoogleIdentity> {
  const { clientId, clientSecret } = googleConfig();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string };
  if (!res.ok || !data.id_token) throw new AuthError("token_exchange", data.error ?? `HTTP ${res.status}`);
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(data.id_token, jwks, { issuer: ISSUERS, audience: clientId }));
  } catch (e) {
    throw new AuthError("bad_token", e instanceof Error ? e.message : "invalid id token");
  }
  return validateGoogleClaims(payload as JWTPayload & Record<string, unknown>, clientId);
}

/** Where Google should send the user back. In production always the canonical site URL. */
export function redirectUriFor(requestOrigin: string): string {
  const site = process.env.NODE_ENV === "production" && process.env.SITE_URL ? process.env.SITE_URL.replace(/\/$/, "") : requestOrigin;
  return `${site}/api/auth/google/callback`;
}
