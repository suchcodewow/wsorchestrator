/** Which bootcamp a score would be saved against, or why nothing can be scored. */

import { CalendarCheck, CalendarX } from "lucide-react";
import type { EvalsAssessmentStage } from "@/db/schema";
import type { ActiveBootcamp } from "@/lib/scheduler/bootcamps";
import { formatDate } from "../cohort-settings/format";

export function BootcampNotice({ stage, bootcamp }: { stage: EvalsAssessmentStage; bootcamp: ActiveBootcamp | null }) {
  if (bootcamp) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <CalendarCheck className="size-4 shrink-0" />
        Scoring at the bootcamp starting{" "}
        <span className="font-medium text-foreground">{formatDate(bootcamp.startDate)}</span>
      </p>
    );
  }
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-500">
      <CalendarX className="size-4 shrink-0" />
      {stage === "intermediate"
        ? "No active bootcamp holds an intermediate class, so nothing can be scored here."
        : "No bootcamp is active, so nothing can be scored."}
    </p>
  );
}
