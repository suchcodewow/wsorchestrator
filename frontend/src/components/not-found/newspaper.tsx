/** 404 as the front page of a newspaper that has finally got its scoop. */

import { blackletter, playfair } from "./fonts";
import { ReturnHome } from "./return-home";

export function Newspaper({ path }: { path: string }) {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <main
      className={`${blackletter.variable} ${playfair.variable} min-h-dvh bg-[#e9e2d0] px-3 py-6 text-[#1b1a17] sm:px-6 sm:py-10`}
    >
      <article className="mx-auto max-w-5xl bg-[#f6f1e4] px-5 py-6 shadow-[0_30px_60px_-30px_rgba(0,0,0,0.45)] sm:rotate-[-0.6deg] sm:px-10 sm:py-8">
        <header className="border-b-4 border-double border-[#1b1a17] pb-3 text-center">
          <p className="font-(family-name:--font-blackletter) text-[clamp(2.4rem,8vw,5.5rem)] leading-none">
            The Daily Endpoint
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#1b1a17] pt-2 font-(family-name:--font-playfair) text-[11px] tracking-[0.18em] uppercase sm:text-xs">
            <span>Vol. 404 · No. 404</span>
            <span>{today}</span>
            <span>Price: one HTTP request</span>
          </div>
        </header>

        <div className="mt-3 text-center">
          <span className="inline-block -rotate-3 border-2 border-red-700 px-3 py-0.5 font-(family-name:--font-playfair) text-sm font-black tracking-[0.3em] text-red-700 uppercase">
            Extra! Extra!
          </span>
          <h1 className="mt-3 font-(family-name:--font-playfair) text-[clamp(2.6rem,8.5vw,6.5rem)] leading-[0.92] font-black tracking-tight text-balance uppercase">
            Page vanishes without a trace
          </h1>
          <p className="mx-auto mt-4 max-w-2xl font-(family-name:--font-playfair) text-lg italic sm:text-xl">
            Witnesses describe a perfectly ordinary URL; authorities baffled; routing table &ldquo;doing its best&rdquo;
          </p>
        </div>

        <div className="my-8 flex justify-center">
          <ReturnHome />
        </div>

        <div className="grid gap-8 border-t border-[#1b1a17] pt-6 md:grid-cols-[2fr_1fr]">
          <div className="columns-1 gap-8 font-(family-name:--font-playfair) text-[15px] leading-relaxed text-justify hyphens-auto sm:columns-2">
            <p className="first-letter:float-left first-letter:mr-2 first-letter:text-6xl first-letter:leading-[0.8] first-letter:font-black">
              HARNESS EVENTS — A page reported at{" "}
              <span className="font-mono text-[13px] break-all">{path}</span> was declared missing this morning, after a
              visitor arrived to find nothing but a status code and an uncomfortable silence.
            </p>
            <p className="mt-3">
              &ldquo;It was here a minute ago,&rdquo; said one router, who asked not to be named because it is not
              authorized to speak to the press. &ldquo;Or it was never here at all. Honestly, the logs are unclear.&rdquo;
            </p>
            <p className="mt-3">
              Search parties combed the sidebar, the settings tabs and the back of the database, turning up three expired
              sessions, a lab guide&rsquo;s missing semicolon and a single unattributed cookie.
            </p>
            <p className="mt-3">
              Experts urge anyone who encounters the page not to approach it, and to return home instead, where the kettle
              is on. <em>Continued on page 200.</em>
            </p>
          </div>

          <aside className="space-y-5">
            <figure>
              {/* A halftone of a blurry blob: the dots thin out from the middle. */}
              <div className="aspect-4/3 border border-[#1b1a17] p-2">
                <div className="size-full bg-[radial-gradient(circle,#1b1a17_1.4px,transparent_1.6px)] bg-size-[6px_6px] mask-[radial-gradient(ellipse_at_50%_55%,black_20%,transparent_68%)]" />
              </div>
              <figcaption className="mt-1.5 font-(family-name:--font-playfair) text-xs italic">
                Artist&rsquo;s impression of the page. Not pictured: the page.
              </figcaption>
            </figure>
            <dl className="border-y border-[#1b1a17] py-3 font-(family-name:--font-playfair) text-sm">
              {[
                ["Weather", "100% chance of 404"],
                ["Tides", "Out"],
                ["Lottery", "4 · 0 · 4"],
                ["Horoscope", "A detour is not a dead end"],
              ].map(([term, value]) => (
                <div key={term} className="flex justify-between gap-4 py-0.5">
                  <dt className="font-bold tracking-wider uppercase">{term}</dt>
                  <dd className="text-right italic">{value}</dd>
                </div>
              ))}
            </dl>
          </aside>
        </div>
      </article>
    </main>
  );
}
