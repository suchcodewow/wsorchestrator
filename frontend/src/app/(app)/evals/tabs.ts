/** The tabs across the top of eVals: one per stage an assessment can score. */

import { GraduationCap, Tent, type LucideIcon } from "lucide-react";
import type { EvalsAssessmentStage } from "@/db/schema";
import { STAGE_LABELS } from "@/lib/evals/assessment-values";

export type EvalsTab = { href: string; label: string; Icon: LucideIcon; stage: EvalsAssessmentStage };

export const EVALS_TABS: EvalsTab[] = [
  { href: "/evals/bootcamp", label: STAGE_LABELS.bootcamp, Icon: Tent, stage: "bootcamp" },
  { href: "/evals/intermediate", label: STAGE_LABELS.intermediate, Icon: GraduationCap, stage: "intermediate" },
];
