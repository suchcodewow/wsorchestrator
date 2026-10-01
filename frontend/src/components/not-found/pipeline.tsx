"use client";

/** 404 as a pipeline execution that failed at the one stage that mattered. */

import { AmbientBackdrop } from "@/components/ambient-backdrop";
import { BrandMark } from "@/components/brand-mark";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "framer-motion";
import { Check, CircleSlash, X } from "lucide-react";
import { useEffect, useState } from "react";
import { ReturnHome } from "./return-home";

type Stage = { name: string; detail: string; status: "ok" | "failed" | "skipped" };

const STAGES: Stage[] = [
  { name: "Resolve URL", detail: "0.004s", status: "ok" },
  { name: "Locate page", detail: "404", status: "failed" },
  { name: "Render", detail: "skipped", status: "skipped" },
  { name: "Celebrate", detail: "skipped", status: "skipped" },
];

function logLines(path: string): [level: "INFO" | "WARN" | "ERROR", text: string][] {
  return [
    ["INFO", `Resolving route ${path}`],
    ["INFO", "Route resolved to: absolutely nothing"],
    ["INFO", "Checking under the sofa cushions"],
    ["INFO", "Checking behind the fridge"],
    ["WARN", "Found 3 expired sessions and a lab guide's missing semicolon"],
    ["INFO", "Asking the database nicely"],
    ["WARN", "Database replied 'new phone, who dis'"],
    ["INFO", "Retrying with more confidence (attempt 2 of 1)"],
    ["WARN", "Page last seen heading towards /dev/null"],
    ["ERROR", "404: page has left the building"],
    ["INFO", "Rollback strategy available: Return Home"],
  ];
}

const LEVEL_CLASS = {
  INFO: "text-sky-300",
  WARN: "text-amber-300",
  ERROR: "text-red-400",
} as const;

export function Pipeline({ path }: { path: string }) {
  const reduce = useReducedMotion();
  const lines = logLines(path);
  const [shown, setShown] = useState(0);
  const visible = reduce ? lines.length : shown;

  useEffect(() => {
    if (reduce || shown >= lines.length) return;
    const id = setTimeout(() => setShown((n) => n + 1), 380);
    return () => clearTimeout(id);
  }, [reduce, shown, lines.length]);

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-12">
      <AmbientBackdrop className="fixed inset-0 -z-10" />

      <div className="w-full max-w-3xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <BrandMark />
            <div>
              <h1 className="text-lg font-medium">Execution #404</h1>
              <p className="text-sm text-muted-foreground">
                Pipeline <span className="font-mono">fetch-this-page</span> · triggered by you, just now
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-destructive/30 bg-destructive/10 px-3 py-1 text-xs font-medium text-destructive">
            <span className="size-1.5 rounded-full bg-destructive" />
            Failed
          </span>
        </div>

        <ol className="mt-8 grid gap-3 sm:grid-cols-4">
          {STAGES.map((stage, i) => (
            <li key={stage.name} className="relative">
              {i > 0 && (
                <span
                  aria-hidden
                  className={cn(
                    "absolute top-1/2 -left-3 hidden h-px w-3 sm:block",
                    stage.status === "skipped" ? "bg-border" : "bg-brand-border",
                  )}
                />
              )}
              <div
                className={cn(
                  "flex items-center gap-3 rounded-lg border bg-card/60 px-3 py-3 backdrop-blur-sm dark:bg-card",
                  stage.status === "failed" && "nf-shake border-destructive/50",
                  stage.status === "skipped" && "opacity-55",
                )}
              >
                <StageIcon status={stage.status} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{stage.name}</p>
                  <p className="font-mono text-xs text-muted-foreground">{stage.detail}</p>
                </div>
              </div>
            </li>
          ))}
        </ol>

        <div className="my-10 flex flex-col items-center gap-3 text-center">
          <p className="text-sm text-muted-foreground">One rollback available.</p>
          <ReturnHome />
        </div>

        <div className="scrollbar-on-dark overflow-x-auto rounded-lg border border-white/10 bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-300 shadow-xl">
          <p className="mb-2 text-zinc-500">Locate page · console</p>
          {lines.slice(0, visible).map(([level, text], i) => (
            <p key={i} className="whitespace-nowrap">
              <span className="text-zinc-600">{String(i + 1).padStart(2, "0")} </span>
              <span className={LEVEL_CLASS[level]}>[{level}]</span> {text}
            </p>
          ))}
          {visible < lines.length && <span className="nf-blink inline-block h-3.5 w-2 bg-zinc-400" />}
        </div>
      </div>
    </main>
  );
}

function StageIcon({ status }: { status: Stage["status"] }) {
  if (status === "ok") {
    return (
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand/15 text-brand">
        <Check className="size-4" />
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-destructive">
        <X className="size-4" />
      </span>
    );
  }
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
      <CircleSlash className="size-4" />
    </span>
  );
}
