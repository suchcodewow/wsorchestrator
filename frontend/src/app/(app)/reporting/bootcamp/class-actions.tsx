"use client";

/**
 * An administrator's two steps for each class of the active bootcamp, in the
 * order they are taken: Generate fills in the participation feedback, then
 * Release shows the class to managers. A released class says when instead.
 */

import { CheckCircle2 } from "lucide-react";
import type { StagePending } from "@/lib/evals/participation";
import { RELEASE_STAGES, STAGE_CODES, type ReleaseStage } from "@/lib/reporting/bootcamp-values";
import { STAGE_LABELS } from "@/lib/evals/assessment-values";
import { formatDate, formatWhen } from "../../cohort-settings/format";
import type { ViewBootcamp } from "./bootcamp-view";
import { GenerateButton } from "./generate-button";
import { ReleaseButton } from "./release-button";

function Status({ bootcamp, stage, pending }: { bootcamp: ViewBootcamp; stage: ReleaseStage; pending: StagePending | null }) {
  const released = bootcamp.released[stage];
  if (stage === "intermediate" && !bootcamp.intermediate) return <>No intermediate class at this bootcamp</>;
  if (released) {
    return (
      <span className="inline-flex items-center gap-1.5" title={formatWhen(released.at)}>
        <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" />
        Released {formatDate(released.at.slice(0, 10))}
        {released.byName && ` by ${released.byName}`}
      </span>
    );
  }
  const waiting = pending?.unscored.total ?? 0;
  return (
    <>
      Not released to managers
      {waiting > 0 && ` · ${waiting.toLocaleString()} waiting on a score`}
    </>
  );
}

export function ClassActions({
  bootcamp,
  pending,
}: {
  bootcamp: ViewBootcamp | null;
  pending: Record<ReleaseStage, StagePending | null>;
}) {
  if (!bootcamp) {
    return (
      <div className="rounded-2xl border bg-card px-5 py-4 text-sm text-muted-foreground shadow-sm">
        No bootcamp is active, so there is nothing to generate or release.
      </div>
    );
  }
  return (
    <div className="divide-y rounded-2xl border bg-card shadow-sm">
      {RELEASE_STAGES.map((stage) => {
        const held = stage === "bootcamp" || bootcamp.intermediate;
        const open = held && !bootcamp.released[stage];
        return (
          <div key={stage} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4">
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="text-sm font-medium">
                {STAGE_LABELS[stage]} <span className="font-normal text-muted-foreground">· {STAGE_CODES[stage]}</span>
              </p>
              <p className="text-sm text-muted-foreground">
                <Status bootcamp={bootcamp} stage={stage} pending={pending[stage]} />
              </p>
            </div>
            {open && (
              <div className="flex flex-wrap gap-2">
                <GenerateButton stage={stage} pending={pending[stage]} />
                <ReleaseButton stage={stage} startDate={bootcamp.startDate} unscored={pending[stage]?.unscored ?? null} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
