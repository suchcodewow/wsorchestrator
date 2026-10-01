/** 404 as the logo gear tumbling through deep space with an astronaut in tow. */

import { ReturnHome } from "./return-home";

/** A tiny seeded PRNG, so the server and every reload draw the same sky. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(404);
const STARS = Array.from({ length: 140 }, () => ({
  top: rand() * 100,
  left: rand() * 100,
  size: rand() < 0.85 ? 1 + rand() * 1.5 : 2.5 + rand() * 1.5,
  duration: 2 + rand() * 4,
  delay: rand() * 5,
}));

const TEETH = [0, 45, 90, 135, 180, 225, 270, 315];

export function LostInSpace({ path }: { path: string }) {
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-[radial-gradient(ellipse_at_30%_20%,#1b2550_0%,#090c1d_55%,#03040a_100%)] px-4 text-white">
      <div aria-hidden className="absolute inset-0">
        {STARS.map((star, i) => (
          <span
            key={i}
            className="nf-twinkle absolute rounded-full bg-white"
            style={
              {
                top: `${star.top}%`,
                left: `${star.left}%`,
                width: star.size,
                height: star.size,
                "--nf-duration": `${star.duration}s`,
                "--nf-delay": `-${star.delay}s`,
              } as React.CSSProperties
            }
          />
        ))}
        <span
          className="nf-shoot absolute top-[8%] right-[-5%] h-0.5 w-40 rounded-full bg-gradient-to-l from-transparent via-white to-white opacity-0"
          style={{ "--nf-delay": "1.5s" } as React.CSSProperties}
        />
        {/* A planet, low on the horizon, for scale. */}
        <span className="absolute -right-24 -bottom-40 size-[28rem] rounded-full bg-[radial-gradient(circle_at_35%_30%,#5eead4,#0f766e_45%,#042f2e_75%)] opacity-70 shadow-[0_0_120px_30px_rgba(45,212,191,0.25)]" />
      </div>

      <div className="relative flex flex-col items-center text-center">
        <div aria-hidden className="nf-drift relative mb-4 flex size-56 items-center justify-center sm:size-72">
          <svg viewBox="0 0 24 24" className="nf-spin size-40 text-brand drop-shadow-[0_0_40px_rgba(45,212,191,0.45)] sm:size-52" style={{ "--nf-duration": "40s" } as React.CSSProperties} fill="none">
            {TEETH.map((angle) => (
              <rect key={angle} x="10.78" y="1.1" width="2.44" height="5.6" rx="0.8" fill="currentColor" transform={`rotate(${angle} 12 12)`} />
            ))}
            <circle cx="12" cy="12" r="6.95" stroke="currentColor" strokeWidth="2.5" />
            <circle cx="12" cy="12" r="1.85" fill="currentColor" opacity="0.45" />
          </svg>
          <span className="absolute top-1/2 left-1/2 -mt-6 -ml-6">
            <span
              className="nf-orbit block text-5xl [--nf-radius:120px] sm:[--nf-radius:150px]"
              style={{ transform: "translateX(var(--nf-radius))" }}
            >
              🧑‍🚀
            </span>
          </span>
        </div>

        <p className="text-[clamp(4rem,14vw,9rem)] leading-none font-semibold tracking-tighter bg-gradient-to-b from-white to-white/25 bg-clip-text text-transparent">
          404
        </p>
        <h1 className="mt-3 text-2xl font-medium sm:text-3xl">Houston, we have a 404.</h1>
        <p className="mt-3 max-w-md text-balance text-white/65">
          The page at <span className="font-mono text-white/90 break-all">{path}</span> has drifted out of orbit. Mission control
          recommends an immediate return.
        </p>
        <ReturnHome className="mt-8" />
      </div>
    </main>
  );
}
