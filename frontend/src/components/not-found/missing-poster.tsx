/** 404 as a lost-page poster pinned to a community corkboard. */

import { marker } from "./fonts";
import { ReturnHome } from "./return-home";

const TABS = 8;
/** The one somebody already took. */
const TORN = 2;

export function MissingPoster({ path }: { path: string }) {
  return (
    <main
      className={`${marker.variable} relative flex min-h-dvh items-center justify-center overflow-hidden bg-[#b5814e] bg-[radial-gradient(rgba(0,0,0,0.18)_1px,transparent_1.5px),radial-gradient(rgba(255,255,255,0.12)_1px,transparent_1.5px)] [background-position:0_0,7px_9px] [background-size:13px_13px,17px_17px] px-4 py-14 text-[#1d1b18]`}
    >
      <Note className="top-[9%] left-[6%] -rotate-6 bg-[#fef08a]">
        LOST: my 200 OK.
        <br />
        Sentimental value.
      </Note>
      <Note className="right-[7%] bottom-[12%] rotate-[5deg] bg-[#bae6fd]">
        FOUND: one 302.
        <br />
        Call if yours.
      </Note>
      <Note className="top-[14%] right-[9%] rotate-3 bg-[#fbcfe8]">
        Band practice
        <br />
        Thurs · bring cables
      </Note>

      <article className="relative w-full max-w-md rotate-[-1.5deg] bg-[#fbfaf6] px-7 pt-10 pb-0 shadow-[0_25px_40px_-15px_rgba(0,0,0,0.55)]">
        <Pin className="top-3 left-1/2 -translate-x-1/2" />

        <h1 className="text-center font-(family-name:--font-marker) text-[clamp(3.5rem,14vw,5.5rem)] leading-none text-red-600">
          MISSING
        </h1>
        <p className="mt-2 text-center text-sm font-bold tracking-[0.2em] uppercase">Have you seen this page?</p>

        <div className="mx-auto mt-5 w-48 rotate-2 bg-white p-2.5 pb-8 shadow-md ring-1 ring-black/10">
          <div className="flex aspect-square items-center justify-center bg-gradient-to-br from-stone-200 to-stone-400 font-(family-name:--font-marker) text-8xl text-stone-500/80">
            ?
          </div>
          <p className="mt-2 text-center font-(family-name:--font-marker) text-sm text-stone-600">last known photo</p>
        </div>

        <dl className="mt-5 space-y-1.5 text-sm">
          <Fact term="Answers to">
            <span className="font-mono text-[13px] break-all">{path}</span>
          </Fact>
          <Fact term="Last seen">Just now, being requested</Fact>
          <Fact term="Features">Had content. Probably.</Fact>
          <Fact term="Reward">One (1) warm cookie, session-scoped</Fact>
        </dl>

        <div className="my-7 flex justify-center">
          <ReturnHome />
        </div>

        {/* Tear-off strips. */}
        <div aria-hidden className="-mx-7 flex border-t-2 border-dashed border-stone-400">
          {Array.from({ length: TABS }, (_, i) => (
            <div
              key={i}
              className={
                i === TORN
                  ? "h-24 flex-1 border-x border-dashed border-stone-300 bg-[#b5814e] shadow-[inset_0_6px_6px_-4px_rgba(0,0,0,0.35)]"
                  : "flex h-24 flex-1 items-center justify-center border-x border-dashed border-stone-300 bg-[#fbfaf6] [writing-mode:vertical-rl]"
              }
              style={i === TORN ? undefined : { transform: `rotate(${(i % 3) - 1}deg)` }}
            >
              {i !== TORN && <span className="font-(family-name:--font-marker) text-[11px] text-stone-700">GO HOME · /</span>}
            </div>
          ))}
        </div>
      </article>
    </main>
  );
}

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-28 shrink-0 font-bold tracking-wide uppercase">{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Note({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <div
      aria-hidden
      className={`absolute hidden w-44 p-4 pt-6 font-(family-name:--font-marker) text-sm leading-snug shadow-lg lg:block ${className}`}
    >
      <Pin className="top-1.5 left-1/2 -translate-x-1/2 scale-75" />
      {children}
    </div>
  );
}

function Pin({ className }: { className: string }) {
  return (
    <span
      aria-hidden
      className={`absolute size-5 rounded-full bg-[radial-gradient(circle_at_35%_30%,#fca5a5,#dc2626_55%,#7f1d1d)] shadow-[0_3px_4px_rgba(0,0,0,0.45)] ${className}`}
    />
  );
}
