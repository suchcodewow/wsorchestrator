"use client";

/**
 * An administrator's steps for each class of the active bootcamp, in the
 * order they are taken: Generate fills in the participation feedback,
 * Preview logs who the release's Slack message would reach, then Release
 * shows the class to managers and sends it. A released class says when
 * instead, and one still waiting on scores, exit exams or overall feedback
 * says for how many.
 */

import { CheckCircle2 } from "lucide-react";
import type { StagePending } from "@/lib/evals/participation";
import { RELEASE_STAGES, type ReleaseStage } from "@/lib/reporting/bootcamp-values";
import { STAGE_LABELS } from "@/lib/evals/assessment-values";
import { formatDate, formatWhen } from "../../cohort-settings/format";
import type { ViewBootcamp } from "../../reporting/bootcamp/bootcamp-view";
import { GenerateButton } from "./generate-button";
import { PreviewButton } from "./preview-button";
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
  if (!pending) return null;
  const waits = [
    [pending.unscored.total, "a score"],
    [pending.noExitExam.total, "an exit exam"],
    [pending.noFeedback.total, "overall feedback"],
  ] as const;
  const shown = waits.filter(([n]) => n > 0).map(([n, what]) => `${n.toLocaleString()} waiting on ${what}`);
  return shown.length > 0 ? <>{shown.join(" · ")}</> : null;
}

export function ClassActions({
  bootcamp,
  pending,
  slackLive,
}: {
  bootcamp: ViewBootcamp | null;
  pending: Record<ReleaseStage, StagePending | null>;
  slackLive: boolean;
}) {
  if (!bootcamp) {
    return (
      <div className="rounded-2xl border bg-card px-5 py-2.5 text-sm text-muted-foreground shadow-sm">
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
          <div key={stage} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-2.5">
            <p className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 text-sm">
              <span className="font-medium">{STAGE_LABELS[stage]}</span>
              <span className="text-muted-foreground">
                <Status bootcamp={bootcamp} stage={stage} pending={pending[stage]} />
              </span>
            </p>
            {open && (
              <div className="flex flex-wrap gap-2">
                <GenerateButton stage={stage} pending={pending[stage]} />
                <PreviewButton stage={stage} />
                <ReleaseButton
                  stage={stage}
                  startDate={bootcamp.startDate}
                  blockers={pending[stage] ?? null}
                  slackLive={slackLive}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
