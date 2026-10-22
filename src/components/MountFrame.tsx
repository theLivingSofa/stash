import { Lightfield } from "./Lightfield";

/** A single slide mount on the lightbox: the frame for sign-in and other standalone screens. */
export function MountFrame({ label, aside, children }: { label: string; aside?: string; children: React.ReactNode }) {
  return (
    <>
      <Lightfield />
      <main className="relative z-[1] flex flex-col justify-center px-5 py-14" style={{ minHeight: "100dvh" }}>
        <div className="glass mx-auto w-full max-w-sm rounded-[30px] p-3" style={{ ["--light" as string]: "var(--accent)" }}>
          <div className="band" aria-hidden>
            <span className="chip-film" />
            <span>{label}</span>
            <span className="tabular opacity-70">No. 0001</span>
            {aside ? <span className="ml-auto opacity-80">{aside}</span> : null}
          </div>
          <div className="window px-6 pt-9 pb-7">{children}</div>
        </div>
      </main>
    </>
  );
}
