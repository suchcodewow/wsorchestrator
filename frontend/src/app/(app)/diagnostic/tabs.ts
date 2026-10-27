/** The tabs across the top of Diagnostic. Takers see none; Assessments Administrators see all three. */

import { FileQuestion, ListChecks, UsersRound } from "lucide-react";
import type { TabItem } from "@/components/tab-nav";

export const IRIS_TABS: TabItem[] = [
  { href: "/diagnostic/tests", label: "Tests", Icon: ListChecks },
  { href: "/diagnostic/cohort", label: "Cohort", Icon: UsersRound },
  { href: "/diagnostic/questions", label: "Questions", Icon: FileQuestion },
];
