"use client";

/**
 * The Code Lab's pull request, once it is open: the description, its commits,
 * the checks the pipeline runs on it one after another, a reviewer's approval
 * once they pass, and the merge button. The checks and the reviewer are
 * scripted; nothing runs.
 */

import { useEffect, useState } from "react";
import { Check, CircleDashed, GitMerge, GitPullRequest, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FILE, TASKS } from "@/lib/mimir/code-lab/scenario";
import { cn } from "@/lib/utils";
import { DiffView } from "./diff-view";

export type Commit = { hash: string; message: string; code: string };

/** What the pipeline runs on a pull request, and how long each takes here, in milliseconds. */
const CHECKS = [
  { name: "Build", by: "Harness CI", ms: 1400 },
  { name: "Unit tests", by: "Harness CI", ms: 1900 },
  { name: "Security scan", by: "Harness STO", ms: 1600 },
  { name: "Preview deploy", by: "Harness CD", ms: 1500 },
];
const REVIEW_MS = 1800;
const REVIEWER = { name: "Alex Rivera", role: "Engineering lead", initials: "AR" };

export const PR_NUMBER = 142;

export function PullRequestPage({
  title,
  body,
  author,
  branch,
  commits,
  baseCode,
  onMerge,
}: {
  title: string;
  body: string;
  author: string;
  branch: string;
  commits: Commit[];
  baseCode: string;
  onMerge: () => void;
}) {
  const [checksDone, setChecksDone] = useState(0);
  const [approved, setApproved] = useState(false);
  const [view, setView] = useState<"conversation" | "files">("conversation");
  const allPassed = checksDone >= CHECKS.length;
  const headCode = commits.at(-1)?.code ?? baseCode;
  const unfinished = TASKS.filter((t) => !t.done(headCode));

  useEffect(() => {
    if (approved) return;
    const t = allPassed
      ? setTimeout(() => setApproved(true), REVIEW_MS)
      : setTimeout(() => setChecksDone((d) => d + 1), CHECKS[checksDone]!.ms);
    return () => clearTimeout(t);
  }, [allPassed, approved, checksDone]);

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h2 className="text-2xl font-medium tracking-tight">
          {title} <span className="font-normal text-muted-foreground">#{PR_NUMBER}</span>
        </h2>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand px-2.5 py-0.5 text-xs font-medium text-brand-foreground">
            <GitPullRequest className="size-3.5" />
            Open
          </span>
          <span>
            <span className="font-medium text-foreground">{author}</span> wants to merge {commits.length} commit{commits.length === 1 ? "" : "s"} into{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">main</code> from{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{branch}</code>
          </span>
        </div>
      </div>

      <div className="flex gap-1 border-b" role="tablist" aria-label="Pull request">
        {(
          [
            ["conversation", "Conversation"],
            ["files", "Files changed"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={view === key}
            onClick={() => setView(key)}
            className={cn(
              "-mb-px cursor-pointer border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              view === key ? "border-brand text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {view === "files" ? (
        <DiffView before={baseCode} after={headCode} file={FILE} />
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border bg-card">
            <div className="border-b px-5 py-2.5 text-sm">
              <span className="font-medium">{author}</span> <span className="text-muted-foreground">opened this pull request</span>
            </div>
            <p className="whitespace-pre-wrap px-5 py-4 text-sm">{body || <span className="text-muted-foreground">No description.</span>}</p>
          </div>

          <div className="divide-y rounded-xl border bg-card text-sm">
            {commits.map((c) => (
              <div key={c.hash} className="flex items-center gap-3 px-5 py-2.5">
                <span className="size-2 shrink-0 rounded-full bg-brand" />
                <span className="min-w-0 grow truncate">{c.message}</span>
                <code className="shrink-0 text-xs text-muted-foreground">{c.hash}</code>
              </div>
            ))}
          </div>

          <div className="divide-y rounded-xl border bg-card text-sm">
            <div className="px-5 py-3 font-medium">
              {allPassed ? "All checks have passed" : `Running checks: ${checksDone} of ${CHECKS.length} done`}
            </div>
            {CHECKS.map((check, k) => {
              const state = k < checksDone ? "passed" : k === checksDone ? "running" : "queued";
              return (
                <div key={check.name} className="flex items-center gap-3 px-5 py-2.5">
                  {state === "passed" ? (
                    <Check className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Passed" />
                  ) : state === "running" ? (
                    <Loader2 className="size-4 shrink-0 animate-spin text-brand" aria-label="Running" />
                  ) : (
                    <CircleDashed className="size-4 shrink-0 text-muted-foreground" aria-label="Queued" />
                  )}
                  <span className="grow">{check.name}</span>
                  <span className="text-xs text-muted-foreground">{check.by}</span>
                </div>
              );
            })}
          </div>

          {approved && (
            <div className="rounded-xl border bg-card">
              <div className="flex items-center gap-2.5 border-b px-5 py-2.5 text-sm">
                <span className="grid size-6 place-items-center rounded-full bg-muted text-[10px] font-medium">{REVIEWER.initials}</span>
                <span className="font-medium">{REVIEWER.name}</span>
                <span className="text-muted-foreground">{REVIEWER.role} · approved these changes</span>
              </div>
              <p className="px-5 py-4 text-sm">
                {unfinished.length === 0
                  ? "Checks are green and the banner matches the ticket. Nice work, approved! 🎉"
                  : `Checks are green, approved. One note for next time: the ticket also asked to ${unfinished
                      .map((t) => t.label.charAt(0).toLowerCase() + t.label.slice(1))
                      .join(" and ")}.`}
              </p>
            </div>
          )}

          <div
            className={cn(
              "flex flex-wrap items-center justify-between gap-3 rounded-xl border px-5 py-4",
              approved ? "border-brand-border bg-brand/5" : "bg-card",
            )}
          >
            <p className="text-sm">
              {approved ? (
                <span className="font-medium">Ready to merge: checks passed and a reviewer approved.</span>
              ) : allPassed ? (
                <span className="text-muted-foreground">Waiting for {REVIEWER.name} to review…</span>
              ) : (
                <span className="text-muted-foreground">Merging is blocked until the checks pass and someone approves.</span>
              )}
            </p>
            <Button variant="brand" disabled={!approved} onClick={onMerge}>
              <GitMerge />
              Merge pull request
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
