import { Suspense } from "react";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Stash" };

export default function LoginPage() {
  return (
    <main className="flex min-h-full flex-col justify-center px-7 py-16" style={{ minHeight: "100dvh" }}>
      <div className="mx-auto w-full max-w-sm">
        <h1 className="font-serif text-[40px] leading-none font-semibold tracking-tight">Stash</h1>
        <p className="mt-3 font-serif text-[17px] leading-relaxed text-muted">Ideas worth keeping, one card at a time.</p>
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
