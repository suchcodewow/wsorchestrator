"use client";

/** Where this site's secrets went with a token's deploys, and whether they are scrubbed yet. */

import type { ReactNode } from "react";
import { AlertTriangle, Eraser, KeyRound, Loader2, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ScrubRun, ScrubSummary } from "@/lib/harness-scrub";
import { plural, stamp, until } from "./format";

const hasScrubRecord = (s: ScrubSummary) => s.pending + s.scrubbed + s.skipped + s.failed > 0;

export function DeployedCredentials({
  scrub,
  scrubbing,
  disabled,
  run,
  onScrub,
  onDismiss,
}: {
  scrub: ScrubSummary;
  scrubbing: boolean;
  disabled: boolean;
  /** The result of the last Scrub now, until it is dismissed. */
  run: ScrubRun | null;
  onScrub: () => void;
  onDismiss: () => void;
}) {
  if (!hasScrubRecord(scrub)) return null;

  const where =
    scrub.orgs.length === 1 ? (
      <code className="rounded bg-muted px-1 py-0.5 font-mono">{scrub.orgs[0]}</code>
    ) : (
      <>{scrub.orgs.length} organizations</>
    );

  const canScrub = scrub.pending > 0 || scrub.failed > 0;

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <ScrubStatus scrub={scrub} where={where} />

        {canScrub && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-6 px-2 text-xs text-muted-foreground"
            disabled={disabled || scrubbing}
            onClick={onScrub}
            title="Overwrite this site's deployed secrets with a placeholder now"
          >
            {scrubbing ? <Loader2 className="size-3.5 animate-spin" /> : <Eraser className="size-3.5" />}
            Scrub now
          </Button>
        )}
      </div>

      {scrub.problems.length > 0 && (
        <ul className="space-y-0.5 text-xs text-muted-foreground">
          {scrub.problems.map((problem) => (
            <li
              key={`${problem.orgIdentifier}:${problem.secretIdentifier}`}
              className="flex flex-wrap items-baseline gap-x-1.5"
            >
              <code className="font-mono text-foreground">{problem.secretIdentifier}</code>
              <span
                className={problem.status === "failed" ? "text-destructive" : "text-amber-600 dark:text-amber-500"}
              >
                {problem.status === "failed" ? "failed" : "left alone"}
              </span>
              {problem.note && <span className="w-full">{problem.note}</span>}
            </li>
          ))}
        </ul>
      )}

      {run && <ScrubRunResult run={run} onDismiss={onDismiss} />}
    </div>
  );
}

/** One line: still live and when they go, all scrubbed, or some that would not. */
function ScrubStatus({ scrub, where }: { scrub: ScrubSummary; where: ReactNode }) {
  if (scrub.pending > 0) {
    return (
      <>
        <KeyRound className="size-3.5 shrink-0" />
        <span>
          <span className="font-medium text-foreground">{scrub.pending}</span> of this site&apos;s secret
          {plural(scrub.pending)} {plural(scrub.pending, "are", "is")} live in {where} — scrubbed to{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono">123</code>{" "}
          {scrub.dueAt ? until(scrub.dueAt) : "at the next sweep"}
        </span>
      </>
    );
  }

  if (scrub.problems.length === 0) {
    return (
      <>
        <ShieldCheck className="size-3.5 shrink-0 text-brand" />
        <span>
          Deployed credentials scrubbed
          {scrub.scrubbedAt && (
            <>
              {" "}
              <time dateTime={scrub.scrubbedAt}>{stamp(scrub.scrubbedAt)}</time>
            </>
          )}
          {" — "}
          {scrub.scrubbed} value{plural(scrub.scrubbed)} in {where} now hold{plural(scrub.scrubbed, "", "s")} a
          placeholder
        </span>
      </>
    );
  }

  return (
    <>
      <AlertTriangle className="size-3.5 shrink-0 text-amber-600 dark:text-amber-500" />
      <span>
        {scrub.problems.length} of this site&apos;s secrets in {where} could not be scrubbed
      </span>
    </>
  );
}

function ScrubRunResult({ run, onDismiss }: { run: ScrubRun; onDismiss: () => void }) {
  return (
    <p role="status" className="flex items-start gap-1.5 text-xs text-muted-foreground">
      <span>
        {run.scrubbed} scrubbed
        {run.skipped > 0 && <>, {run.skipped} left alone</>}
        {run.failed > 0 && <span className="text-destructive">, {run.failed} failed</span>}
        {run.scrubbed + run.skipped + run.failed === 0 && <>Nothing left to scrub.</>}
      </span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss" className="transition-colors hover:text-foreground">
        <X className="size-3" />
      </button>
    </p>
  );
}
