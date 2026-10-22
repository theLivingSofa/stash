import Link from "next/link";
import { cookies } from "next/headers";
import type { GoogleIdentity } from "@/lib/auth/google";
import { PENDING_COOKIE, readTemp } from "@/lib/auth/session";
import { RequestForm } from "./RequestForm";
import { MountFrame } from "@/components/MountFrame";

export const metadata = { title: "Request access · Stash" };

export default async function RequestAccessPage() {
  const who = await readTemp<GoogleIdentity>((await cookies()).get(PENDING_COOKIE)?.value);
  return (
    <MountFrame label="Stash" aside="Invite only">
        <h1 className="display text-[34px] leading-[1.02]" style={{ fontStretch: "72%" }}>Stash is invite-only</h1>
        {who ? (
          <>
            <p className="mt-3 font-serif text-[17px] leading-relaxed text-muted">
              You&apos;re signed in as <span className="text-text">{who.name ?? who.email}</span>
              {who.name ? <> ({who.email})</> : null}, but this account isn&apos;t on the list yet.
            </p>
            <RequestForm />
          </>
        ) : (
          <>
            <p className="mt-3 font-serif text-[17px] leading-relaxed text-muted">
              Sign in with Google first, then you can ask for access.
            </p>
            <Link href="/login" className="label mt-8 block rounded-full bg-accent px-4 py-3.5 text-center text-[16px] text-accent-ink">
              Go to sign in
            </Link>
          </>
        )}
    </MountFrame>
  );
}
