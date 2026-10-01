"use client";

/**
 * 404 as a machine that has given up and started writing poetry about it.
 * Enter goes home; Esc inverts the screen, for anyone who dares.
 */

import { useReducedMotion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ReturnHome } from "./return-home";

function trace(path: string) {
  return {
    left: [
      "SYSTEM: HARNESS_EVENTS_404_HANDLER",
      "RUNNING ERROR ROUTINE...",
      ">>> PAGE_NOT_FOUND_EXCEPTION",
      "",
      "0x404 ORCHESTRATOR // ROUTE RESOLUTION",
      `FAILURE AT: [${path}]`,
      "STATUS: NULL_PAGE_REFERENCE",
      "RETURN CODE: -404",
    ],
    middle: [
      "0001 LOAD /EVENTS",
      "0002 RUN  /LABS",
      "0003 RUN  /RUNS",
      `0004 RUN  ${path}`,
      "0005 EXIT",
      "",
      "IF LOST == TRUE THEN",
      '  PRINT "A PAGE IS NEVER LOST, ONLY MISPLACED."',
      "",
      "> PIPELINE HALTED",
      "> STAGE [FETCH_PAGE] NOT ALLOCATED",
      "> ROLLBACK PATH UNDEFINED",
      "> INITIATE MANUAL REBOOT (HOME)",
      "",
      "ERROR 404XAF: RESOURCE NOT FOUND",
      "CAUSE: UNKNOWN",
      "LIKELY REASONS:",
      " - PAGE DELETED",
      " - PATH CORRUPTED",
      " - PAGE WENT TO A WORKSHOP AND NEVER CAME BACK",
    ],
    right: [
      "NOTE_01: NOT ALL MISTAKES ARE ERRORS.",
      "NOTE_02: SOMETIMES LOSS CREATES FORM.",
      "NOTE_03: EVERYTHING BROKEN STILL RUNS SOMEHOW.",
      "",
      "> SYSTEM TRACE INDICATES AN ABSENCE RATHER THAN A FAULT.",
      "> NO CORRUPTION DETECTED. NO DELETION RECORDED.",
      "> THE SERVER REPORTS SILENCE. NOT ERROR, BUT AWE.",
      "",
      "[MEMORY DUMP /DEV/EVENTS/LOGS/404]",
      "0001 > THE SYSTEM REMEMBERS LIGHT, BUT NOT WHAT IT LIT.",
      "0002 > IT RECALLS VISITORS. GHOST REQUESTS. PINGS.",
      "0003 > SOMEONE TYPED A PATH THAT NEVER EXISTED.",
      "0004 > “THIS ISN’T AN ERROR,” IT THOUGHT. “IT’S A DETOUR.”",
      "0005 > END OF MEMORY SECTOR 404.",
    ],
  };
}

/** One line per tick, so the whole dump lands in about a second. */
const TICK_MS = 55;

export function BlueScreen({ path }: { path: string }) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(0);
  const [inverted, setInverted] = useState(false);
  const { left, middle, right } = trace(path.length > 48 ? `${path.slice(0, 45)}...` : path);
  const total = Math.max(left.length, middle.length, right.length);
  const visible = reduce ? total : shown;

  useEffect(() => {
    if (reduce || shown >= total) return;
    const id = setTimeout(() => setShown((n) => n + 1), TICK_MS);
    return () => clearTimeout(id);
  }, [reduce, shown, total]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // Enter on a focused link already follows it; only take bare Enter.
      if (event.key === "Enter" && document.activeElement === document.body) router.push("/");
      if (event.key === "Escape") setInverted((v) => !v);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  return (
    <main
      className="relative flex min-h-dvh flex-col overflow-hidden bg-[#1010ff] px-6 py-6 font-mono text-[11px] leading-[1.55] tracking-wide text-white uppercase transition-[filter] duration-150 sm:px-8 sm:text-xs"
      style={{ filter: inverted ? "invert(1)" : undefined }}
    >
      <h1 className="sr-only">Page not found</h1>

      <div className="grid flex-1 gap-8 md:grid-cols-[1fr_1.4fr_1.4fr]">
        <Column
          lines={left}
          visible={visible}
          className="hidden md:block"
          header={<p className="mb-[30vh]">:/ ORCHESTRATOR.EXE</p>}
        />

        <Column
          lines={middle}
          visible={visible}
          header={
            <p className="mb-4">
              <span className="mr-2 inline-block h-[1em] w-14 bg-white align-middle" />
              404 ERROR : PAGE NOT FOUND
            </p>
          }
          footer={<Stretched text="> GO HOME" />}
        />

        <Column
          lines={right}
          visible={visible}
          className="hidden lg:block"
          footer={<Stretched text=">>> ATTEMPTING TO RENDER THE VOID AS TEXT..." />}
        />
      </div>

      <footer className="mt-8 grid gap-x-8 gap-y-2 md:grid-cols-[1fr_1.4fr_1.4fr]">
        <p className="hidden md:block">&gt; 404 PAGE NOT FOUND</p>
        <p>
          &gt; PRESS ENTER TO REBOOT
          <span className="nf-blink ml-1 inline-block h-[1em] w-[0.6em] translate-y-[2px] bg-white" />
        </p>
        <p className="hidden sm:block">
          OR PRESS <kbd className="bg-white px-1 text-[#1010ff]">ESC</kbd> IF YOU DARE.
        </p>
      </footer>

      {/* Centred over everything, on a patch of cleared screen so the dump
          does not run through it; the overlay itself lets clicks through. */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="bg-[#1010ff] px-6 py-5 shadow-[0_0_24px_24px_#1010ff]">
          <ReturnHome className="font-sans tracking-normal normal-case" />
        </div>
      </div>
    </main>
  );
}

/** A column of the dump, typed out line by line; its footer lands once it is done. */
function Column({
  lines,
  visible,
  className,
  header,
  footer,
}: {
  lines: string[];
  visible: number;
  className?: string;
  header?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <section className={className}>
      {header}
      <pre className="font-mono whitespace-pre-wrap">{lines.slice(0, visible).join("\n")}</pre>
      {visible >= lines.length && footer}
    </section>
  );
}

/** A line repeated and pulled taller each time, like a CRT losing vertical hold. */
function Stretched({ text }: { text: string }) {
  return (
    <div aria-hidden className="mt-6 select-none">
      {[1, 1.8, 2.6, 3.2, 3.8].map((scale, i) => (
        <p
          key={scale}
          className="origin-top overflow-hidden whitespace-nowrap"
          style={{ transform: `scaleY(${scale})`, marginBottom: `${scale * 0.9}em`, opacity: 1 - i * 0.08 }}
        >
          {text}
        </p>
      ))}
    </div>
  );
}
