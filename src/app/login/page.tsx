import { Suspense } from "react";
import { MountFrame } from "@/components/MountFrame";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Stash" };

export default function LoginPage() {
  return (
    <MountFrame label="Stash" aside="Invite only">
      <h1 className="display text-[56px] leading-[0.88] tracking-[-0.02em]" style={{ fontStretch: "66%" }}>
        Stash
      </h1>
      <p className="mt-3 font-serif text-[18px] leading-relaxed text-muted">Ideas worth keeping, one card at a time.</p>
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </MountFrame>
  );
}
