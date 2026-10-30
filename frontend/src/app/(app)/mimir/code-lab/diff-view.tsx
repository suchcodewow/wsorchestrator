"use client";

/** One file's changes, the way a pull request shows them: changed lines in red and green, with a little context. */

import { useMemo } from "react";
import { diffHunks, diffStats, lineDiff } from "@/lib/mimir/code-lab/diff";
import { cn } from "@/lib/utils";

const SIGN = { same: " ", add: "+", del: "-" } as const;

export function DiffView({ before, after, file, className }: { before: string; after: string; file: string; className?: string }) {
  const lines = useMemo(() => lineDiff(before, after), [before, after]);
  const hunks = diffHunks(lines);
  const { added, removed } = diffStats(lines);

  return (
    <div className={cn("overflow-hidden rounded-xl border bg-card", className)}>
      <div className="flex items-center justify-between gap-3 border-b bg-muted/50 px-4 py-2 text-xs">
        <span className="font-mono font-medium">{file}</span>
        <span className="tnum font-mono">
          <span className="text-emerald-600 dark:text-emerald-400">+{added}</span> <span className="text-destructive">−{removed}</span>
        </span>
      </div>
      {hunks.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">No changes yet.</p>
      ) : (
        <div className="divide-y divide-dashed">
          {hunks.map((hunk, h) => (
            <div key={h} className="py-1">
              {hunk.map((l, k) => (
                <div key={k} className="cl-diff-row" data-kind={l.kind}>
                  <span>{l.kind === "add" ? "" : l.oldNo}</span>
                  <span>{l.kind === "del" ? "" : l.newNo}</span>
                  <span>{SIGN[l.kind]}</span>
                  <span>{l.text || " "}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
