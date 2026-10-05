/** What one deploy did, step by step, until it is dismissed. */

import { ExternalLink, X } from "lucide-react";
import type { DeployOutcome, DeployReport } from "@/lib/harness-deploy";
import { cn } from "@/lib/utils";
import { countOf } from "./format";

const OUTCOME: Record<DeployOutcome, { label: string; className: string }> = {
  created: { label: "created", className: "text-brand" },
  existed: { label: "already there", className: "text-muted-foreground" },
  failed: { label: "failed", className: "text-destructive" },
  skipped: { label: "skipped", className: "text-amber-600 dark:text-amber-500" },
};

const OUTCOMES = Object.keys(OUTCOME) as DeployOutcome[];

export function DeployReportPanel({ report, onClose }: { report: DeployReport; onClose: () => void }) {
  const { counts } = report;

  return (
    <section aria-label={`Deploy to ${report.orgName}`} className="space-y-2 rounded-lg border bg-muted/30 p-3">
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className="font-medium text-foreground">{report.orgName}</span>
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-muted-foreground">{report.orgIdentifier}</code>
        <a
          href={report.orgUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-brand hover:underline"
        >
          Open in Harness
          <ExternalLink className="size-3" />
        </a>

        <span className="ml-auto flex items-center gap-2 text-muted-foreground">
          {OUTCOMES.filter((outcome) => counts[outcome] > 0).map((outcome) => (
            <span key={outcome} className={OUTCOME[outcome].className}>
              {counts[outcome]} {OUTCOME[outcome].label}
            </span>
          ))}
          <button
            type="button"
            onClick={onClose}
            aria-label="Dismiss this report"
            className="transition-colors hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </span>
      </header>

      <p className="text-xs text-muted-foreground">
        Read from {countOf(report.sources, "template source")}.
        {counts.failed > 0 && <> Nothing was rolled back, so whatever did land is still in the organization.</>}
      </p>

      <ul className="max-h-72 space-y-0.5 overflow-y-auto text-xs">
        {report.steps.map((step, i) => (
          <li
            key={i}
            className="flex flex-wrap items-baseline gap-x-2 border-b border-border/40 py-1 last:border-b-0"
          >
            <span className="w-24 shrink-0 text-muted-foreground">{step.kind}</span>
            <code className="font-mono text-foreground">{step.identifier}</code>
            <span className="text-muted-foreground">in {step.scope}</span>
            <span className={cn("ml-auto shrink-0", OUTCOME[step.outcome].className)}>
              {OUTCOME[step.outcome].label}
            </span>
            {step.detail && <span className="w-full text-muted-foreground">{step.detail}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
